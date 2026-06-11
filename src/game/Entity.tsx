import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { World } from './maze'
import type { Hum } from './audio'
import {
  playerState,
  playerControl,
  entityState,
  signalFx,
  proximityFx,
  deathCam,
  DEATH_FALL,
  gameState,
  huntFx,
} from './retro'

// ---------------------------------------------------------------------------
// The entity: a thing that hunts you through the rooms — but like a curious
// predator, not a homing missile. Two minds drive it (Alien-Isolation style):
//
//  • A DIRECTOR that always knows where you are. It never moves the creature
//    directly; instead it raises a "menace" the longer it's near you and feeds
//    the creature a target hint, so the creature always trends toward your area
//    (you'll actually run into it) without beelining at you.
//
//  • The CREATURE itself, which only knows what it can sense (sight, fog-limited
//    + hearing, louder when you sprint). It stalks: drifts in, peeks at you from
//    behind a pillar, comes close then bolts away again — building boldness each
//    pass — until menace + boldness tip it over and it COMMITS to a real chase.
//
// While it's near, the signal frays (proximityFx) and a sub-bass presence swells
// (hum.setPresence) — you feel it before you see it. If it reaches you the
// camcorder is dropped: the camera tumbles to the floor, the tape cuts to static
// (found-footage signal loss) and you come to somewhere else.
// ---------------------------------------------------------------------------

const SIGHT = 18 // how far it can see you (roughly the fog reach), metres
const HEAR_BASE = 4 // it senses you this close even in dead silence
const HEAR_GAIN = 26 // + this much hearing radius at full noise (sprint ≈ 30m, creep ≈ 7m)
const CATCH = 1.2 // distance at which it gets you
const LOSE_TIME = 3.2 // seconds out of sight before a chase downgrades to a search
const SEARCH_TIME = 8 // seconds hunting your last spot before giving up

// Stalker tuning (all in metres / seconds).
const AWARE = 24 // within this it becomes aware of you and starts stalking
const FORGET = 34 // drift beyond this (while stalking) for a while → lose interest
const STALK_NEAR = 6 // closest it dares to creep while merely curious
const STALK_FAR = 14 // how far it bolts back after a close pass
const PEEK_TIME = 1.6 // seconds it holds a peek (watching you) before repositioning
const COMMIT_BOLD = 1 // boldness needed (with enough menace) to attack
const PROX_FX = 16 // proximity interference/presence starts ramping within this

// Paranormal powers (only used UNOBSERVED, never in chase, never mid-turn — see below).
const OBSERVE_DIST = 18 // within this AND in your view = you are watching it
const OBSERVE_DOT = 0.4 // how centred in your view it must be to count as watched
const TELE_COOLDOWN = 13 // min seconds between teleports — keeps it rare/realistic
const LURK_AVG = 20 // average seconds between opportunistic "relocate" teleports
const SEEN_CALM = 2.5 // after you see it, no powers for this long (it acts natural)
const SEEN_LINGER = 1.4 // how long you must hold it in view before it backs away
const LURK_MIN_DIST = 10 // it only blink-relocates when it's at least this far off

// Death beats (seconds): forced look at the entity, the fall, then time on the
// floor before the signal finally cuts out.
const GRAB_TIME = 1.15
const DOWN_TIME = 1.6 // "1–2 segundos de tocar el suelo" before losing connection

const SPD = { wander: 2.2, investigate: 3.2, chase: 4.3, search: 2.6 }
const STALK_SPD = { approach: 2.9, peek: 0, retreat: 4.4 }
const REPATH = 0.4 // seconds between path recomputes while chasing

// --- Dread: the session-long fatality curve. It only ever rises, so curiosity gives
// way to a relentless hunt and the catch becomes inevitable — the intruder can delay
// the end but never avoid it. ---
const DREAD_RATE = 0.0065 // base rise per second
const DREAD_MOVE = 0.004 // extra rise while you roam the building (you can't hide forever)

type Cell = { x: number; z: number }
type Mode = 'wander' | 'investigate' | 'stalk' | 'chase' | 'search'
type StalkPhase = 'approach' | 'peek' | 'retreat'

// Tall, dark, faceless silhouette. Fog is ON so it dissolves into the haze at
// distance and resolves as it closes — you see a shape coming before you see it.
function makeEntityTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')!
  const cx = 64
  const draw = (armW: number, legW: number) => {
    ctx.fillStyle = 'rgba(1,1,1,1)'
    ctx.strokeStyle = 'rgba(1,1,1,1)'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.ellipse(cx, 42, 10, 13, 0, 0, Math.PI * 2) // head
    ctx.fill()
    ctx.lineWidth = 7
    ctx.beginPath() // neck
    ctx.moveTo(cx, 52)
    ctx.lineTo(cx, 70)
    ctx.stroke()
    ctx.beginPath() // broad-shouldered, tapering torso
    ctx.moveTo(cx - 18, 70)
    ctx.lineTo(cx + 18, 70)
    ctx.lineTo(cx + 11, 188)
    ctx.lineTo(cx - 11, 188)
    ctx.closePath()
    ctx.fill()
    ctx.lineWidth = armW // long arms hanging to the knees
    ctx.beginPath()
    ctx.moveTo(cx - 16, 76)
    ctx.quadraticCurveTo(cx - 26, 140, cx - 20, 196)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 16, 76)
    ctx.quadraticCurveTo(cx + 26, 140, cx + 20, 196)
    ctx.stroke()
    ctx.lineWidth = legW
    ctx.beginPath()
    ctx.moveTo(cx - 6, 186)
    ctx.lineTo(cx - 7, 252)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 6, 186)
    ctx.lineTo(cx + 8, 252)
    ctx.stroke()
  }
  ctx.filter = 'blur(6px)'
  ctx.globalAlpha = 0.6
  draw(12, 14)
  ctx.filter = 'blur(2.5px)'
  ctx.globalAlpha = 1
  draw(8, 10)
  ctx.filter = 'none'
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function Entity({ world, hum }: { world: World; hum: Hum }) {
  const ref = useRef<THREE.Group>(null!)
  const tex = useMemo(() => makeEntityTexture(), [])
  const geom = useMemo(() => new THREE.PlaneGeometry(1.7, 2.7), [])
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: tex, color: '#000000', transparent: true, opacity: 0.96, depthWrite: false }),
    [tex],
  )

  // Entity runtime state (kept in refs to avoid per-frame allocation).
  const epos = useRef({ x: 0, z: 0 })
  const mode = useRef<Mode>('wander')
  const path = useRef<Cell[]>([])
  const pathIdx = useRef(0)
  const repathT = useRef(0)
  const goalCell = useRef<Cell>({ x: 0, z: 0 })
  const lastKnown = useRef({ x: 0, z: 0 })
  const loseT = useRef(0)
  const searchT = useRef(0)
  const spawnT = useRef(6) // grace period before the hunt begins
  const started = useRef(false)
  const death = useRef({ phase: 'none' as 'none' | 'grab' | 'fall' | 'down' | 'reboot', t: 0 })
  const summon = useRef(false) // DEV: key 8 drops it right on top of you, chasing

  // --- Director (omniscient) + stalker state ---------------------------------
  const menace = useRef(0) // 0..1, rises near you, the global pressure to attack
  const boldness = useRef(0) // 0..1, rises while peeking close & unwatched
  const stalkPhase = useRef<StalkPhase>('approach')
  const peekT = useRef(0)
  const stalkSpot = useRef({ x: 0, z: 0 }) // a cover cell near you it creeps to
  const refreshT = useRef(0) // periodic re-find of the stalk spot (tracks you)
  const farT = useRef(0) // time spent beyond FORGET while stalking

  // --- Paranormal powers state -----------------------------------------------
  const teleCd = useRef(7) // teleport cooldown timer (anti-abuse)
  const wasObserved = useRef(false) // were you looking at it last frame?
  const seenCalm = useRef(0) // grace after being seen — no powers while > 0
  const observedT = useRef(0) // how long you've held it in view continuously
  const vanishT = useRef(0) // countdown to a "vanish" teleport after you look away

  // --- Locatable audio + pacing state ----------------------------------------
  const stepDist = useRef(0) // metres travelled since the last audible footfall
  const breathCd = useRef(5) // seconds until the next faint breath cue is allowed
  const lullT = useRef(0) // seconds it deliberately disengages ("loses your scent")
  const faceYaw = useRef(0) // facing yaw of the camera-facing silhouette billboard

  // --- Behaviour/AI: dread curve, player-velocity tracking, flanking, hiding -------
  const dread = useRef(0) // 0..1 session-long fatality curve (only rises)
  const playerPrev = useRef({ x: 0, z: 0 }) // last player pos (for velocity/heading)
  const pvel = useRef({ x: 0, z: 0 }) // smoothed player velocity, units/sec
  const interceptCd = useRef(6) // cooldown between flanking/intercept moves
  const quietT = useRef(0) // seconds you've stayed hidden AND quiet (trail going cold)
  const lastRespawnSeq = useRef(0) // detect respawn teleports to avoid velocity spikes

  // DEV/test hotkey: summon the entity into an immediate chase nearby so the hunt /
  // catch / found-footage death can be verified without wandering into it. Remove
  // for a clean build.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Digit8') summon.current = true
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const w2c = world.worldToCell
  const c2w = world.cellToWorld

  // --- helpers ---
  const walkable = (gx: number, gz: number) => !world.isWall(gx, gz)

  // Bresenham-ish line-of-sight: march from a→b in small steps; blocked if any
  // sampled point is inside a pillar.
  const losClear = (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax
    const dz = bz - az
    const dist = Math.hypot(dx, dz)
    const steps = Math.ceil(dist / 0.45)
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      if (world.collides(ax + dx * t, az + dz * t)) return false
    }
    return true
  }

  // A* over the 4-connected grid of walkable cells, bounded so it can never run
  // away on the infinite map. Returns world-space waypoints (excluding the start),
  // or a single greedy step toward the goal if no path is found in budget.
  const astar = (sx: number, sz: number, gx: number, gz: number): Cell[] => {
    // If the goal cell is solid (an iconic support column), the search can never
    // terminate on it and would burn the ENTIRE node budget on every call — which,
    // during a chase (repathed every frame), pins the main thread and freezes the
    // game. Snap the goal to the nearest walkable cell so the search can finish.
    if (!walkable(gx, gz)) {
      let snapped = false
      for (let r = 1; r <= 4 && !snapped; r++) {
        for (let ox = -r; ox <= r && !snapped; ox++) {
          for (let oz = -r; oz <= r && !snapped; oz++) {
            if (Math.abs(ox) !== r && Math.abs(oz) !== r) continue // ring only
            if (walkable(gx + ox, gz + oz)) {
              gx += ox
              gz += oz
              snapped = true
            }
          }
        }
      }
      if (!snapped) return []
    }
    if (sx === gx && sz === gz) return []
    const key = (x: number, z: number) => x * 100000 + z
    const open = new Map<number, { x: number; z: number; g: number; f: number }>()
    const came = new Map<number, number>()
    const gScore = new Map<number, number>()
    const closed = new Set<number>()
    const h = (x: number, z: number) => Math.abs(x - gx) + Math.abs(z - gz)
    const sK = key(sx, sz)
    open.set(sK, { x: sx, z: sz, g: 0, f: h(sx, sz) })
    gScore.set(sK, 0)
    const MAX_RANGE = 55 // cells from start — hard cap on the search box
    let budget = 3500
    while (open.size && budget-- > 0) {
      // pop lowest f (small open set → linear scan is fine)
      let bestK = -1
      let best: { x: number; z: number; g: number; f: number } | null = null
      for (const [k, n] of open) if (!best || n.f < best.f) { best = n; bestK = k }
      if (!best) break
      open.delete(bestK)
      if (best.x === gx && best.z === gz) {
        // reconstruct
        const cells: Cell[] = []
        let ck = bestK
        while (ck !== sK) {
          const cx = Math.round(ck / 100000)
          const cz = ck - cx * 100000
          cells.push({ x: c2w(cx), z: c2w(cz) })
          const prev = came.get(ck)
          if (prev === undefined) break
          ck = prev
        }
        cells.reverse()
        return cells
      }
      closed.add(bestK)
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [ox, oz] of dirs) {
        const nx = best.x + ox
        const nz = best.z + oz
        if (Math.abs(nx - sx) > MAX_RANGE || Math.abs(nz - sz) > MAX_RANGE) continue
        if (!walkable(nx, nz)) continue
        if (world.wallBetween(best.x, best.z, nx, nz)) continue // a partition blocks this step
        const nK = key(nx, nz)
        if (closed.has(nK)) continue
        const tentative = best.g + 1
        if (tentative < (gScore.get(nK) ?? Infinity)) {
          came.set(nK, bestK)
          gScore.set(nK, tentative)
          open.set(nK, { x: nx, z: nz, g: tentative, f: tentative + h(nx, nz) })
        }
      }
    }
    // Fallback: one greedy walkable step toward the goal (respecting partitions).
    const stepX = Math.sign(gx - sx)
    const stepZ = Math.sign(gz - sz)
    if (stepX !== 0 && !world.wallBetween(sx, sz, sx + stepX, sz) && walkable(sx + stepX, sz))
      return [{ x: c2w(sx + stepX), z: c2w(sz) }]
    if (stepZ !== 0 && !world.wallBetween(sx, sz, sx, sz + stepZ) && walkable(sx, sz + stepZ))
      return [{ x: c2w(sx), z: c2w(sz + stepZ) }]
    return []
  }

  // Pick a random walkable cell roughly `min..max` cells away from (ox,oz).
  const randomGoalNear = (ox: number, oz: number, min: number, max: number): Cell => {
    for (let tries = 0; tries < 24; tries++) {
      const ang = Math.random() * Math.PI * 2
      const d = min + Math.random() * (max - min)
      const gx = Math.round(ox + Math.cos(ang) * d)
      const gz = Math.round(oz + Math.sin(ang) * d)
      if (walkable(gx, gz)) return { x: gx, z: gz }
    }
    return { x: ox, z: oz }
  }

  // Director hint: while it's out of sight (fog hides it past ~SIGHT), it simply
  // prowls straight at your current position — it always knows where you are, so it
  // closes in rather than drifting off. Curiosity (the indirect, peeking stalk)
  // only kicks in once it's within AWARE.
  const wanderGoalFrom = (): [number, number] => [w2c(playerState.x), w2c(playerState.z)]

  // Flanking: predict where you're HEADED and aim there, so it can cut you off and be
  // waiting when you round the corner instead of forever tailing you. The lead grows
  // with dread — it reads you better as the night wears on.
  const interceptGoal = (): [number, number] => {
    const lead = 1.1 + dread.current * 1.4
    const gx = w2c(playerState.x + pvel.current.x * lead)
    const gz = w2c(playerState.z + pvel.current.z * lead)
    if (walkable(gx, gz)) return [gx, gz]
    return [w2c(playerState.x), w2c(playerState.z)]
  }

  // A cover cell near the player to peek from: walkable, ideally tucked beside a
  // pillar (cover) and with a clear line of sight to the player ("se asoma por las
  // columnas"). Scored over several samples; falls back to any near-ish cell.
  const findStalkSpot = (): Cell => {
    const px = playerState.x
    const pz = playerState.z
    let best: { x: number; z: number; score: number } | null = null
    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2
      const d = STALK_NEAR + Math.random() * (STALK_FAR - STALK_NEAR)
      const wx = px + Math.cos(ang) * d
      const wz = pz + Math.sin(ang) * d
      const gx = w2c(wx)
      const gz = w2c(wz)
      if (!walkable(gx, gz)) continue
      const cover = world.wallBetween(gx, gz, gx + 1, gz) || world.wallBetween(gx, gz, gx - 1, gz) || world.wallBetween(gx, gz, gx, gz + 1) || world.wallBetween(gx, gz, gx, gz - 1)
      const sees = losClear(c2w(gx), c2w(gz), px, pz)
      const score = (cover ? 2 : 0) + (sees ? 1 : 0) + Math.random() * 0.5
      if (!best || score > best.score) best = { x: gx, z: gz, score }
    }
    if (best) return { x: best.x, z: best.z }
    return randomGoalNear(w2c(px), w2c(pz), 2, 3)
  }

  const setGoal = (gx: number, gz: number) => {
    goalCell.current = { x: gx, z: gz }
    path.current = astar(w2c(epos.current.x), w2c(epos.current.z), gx, gz)
    pathIdx.current = 0
    repathT.current = REPATH
  }

  // Choose a fresh cover spot near the player to creep to, and path to it.
  const pickStalkSpot = () => {
    const g = findStalkSpot()
    stalkSpot.current = { x: c2w(g.x), z: c2w(g.z) }
    refreshT.current = 1.5
    setGoal(g.x, g.z)
  }

  // Pick a faraway walkable cell on the far side of the entity from the player and
  // head for it — used during a "lull" so the creature genuinely drifts off and the
  // tension gets room to rebuild, instead of forever homing in on you.
  const setLullGoal = () => {
    const px = playerState.x
    const pz = playerState.z
    const baseA = Math.atan2(epos.current.z - pz, epos.current.x - px) // away from you
    for (let tries = 0; tries < 28; tries++) {
      const a = baseA + (Math.random() - 0.5) * 1.4
      const d = 32 + Math.random() * 24
      const gx = w2c(px + Math.cos(a) * d)
      const gz = w2c(pz + Math.sin(a) * d)
      if (walkable(gx, gz)) {
        setGoal(gx, gz)
        return
      }
    }
    setGoal(...wanderGoalFrom())
  }

  // A cell that is OCCLUDED from the player right now but near them — a spot to
  // blink to so it "appears" only once you walk around a pillar, NEVER by a quick
  // camera turn. It must have NO line of sight to you at all (a wall between you),
  // be at least 6 m away, and ideally tucked against a pillar. Spots that are merely
  // outside your view cone but in clear sight are rejected, because whipping the
  // camera round would reveal a thing that wasn't there a moment ago (which the
  // player rightly found cheap). Returns null if nothing suitable was sampled.
  const findHiddenSpot = (px: number, pz: number): Cell | null => {
    let best: { x: number; z: number; score: number } | null = null
    for (let i = 0; i < 44; i++) {
      const ang = Math.random() * Math.PI * 2
      const d = 7 + Math.random() * 10 // 7..17 m
      const wx = px + Math.cos(ang) * d
      const wz = pz + Math.sin(ang) * d
      const gx = w2c(wx)
      const gz = w2c(wz)
      if (!walkable(gx, gz)) continue
      const cx = c2w(gx)
      const cz = c2w(gz)
      if (Math.hypot(cx - px, cz - pz) < 6) continue // never right on top of you
      if (losClear(px, pz, cx, cz)) continue // MUST be wall-occluded — no turn reveals it
      const cover = world.wallBetween(gx, gz, gx + 1, gz) || world.wallBetween(gx, gz, gx - 1, gz) || world.wallBetween(gx, gz, gx, gz + 1) || world.wallBetween(gx, gz, gx, gz - 1)
      const score = (cover ? 2 : 0) + Math.random()
      if (!best || score > best.score) best = { x: gx, z: gz, score }
    }
    return best ? { x: best.x, z: best.z } : null
  }

  // Use the teleport power: blink to an occluded spot near the player and lurk there,
  // so you discover it when you next round a corner. Sets the cooldown.
  const teleport = (px: number, pz: number, announce: boolean) => {
    const spot = findHiddenSpot(px, pz)
    if (!spot) {
      teleCd.current = 2 // nothing occluded nearby; try again shortly
      return
    }
    epos.current.x = c2w(spot.x)
    epos.current.z = c2w(spot.z)
    mode.current = 'stalk'
    stalkPhase.current = 'peek'
    peekT.current = PEEK_TIME * (0.8 + Math.random() * 0.7)
    boldness.current = Math.max(boldness.current, 0.4)
    path.current = []
    teleCd.current = (TELE_COOLDOWN + Math.random() * 5) * (1 - dread.current * 0.5)
    if (announce && Math.random() < 0.4) hum.phantom() // an occasional faint cue
  }

  // Tip from curiosity into a lethal chase.
  const commit = () => {
    mode.current = 'chase'
    menace.current = Math.max(menace.current, 0.9)
    vanishT.current = 0 // cancel any pending blink — no teleporting once it's hunting
    huntFx.level = Math.max(huntFx.level, 0.85) // slam the panic camera FX on
    setGoal(w2c(playerState.x), w2c(playerState.z))
    hum.lunge()
  }

  // Respawn the player far away when caught, and relocate the entity even further
  // so the next encounter has to build again. Resets the Director, too.
  const respawnPlayer = () => {
    let px = playerState.x
    let pz = playerState.z
    for (let tries = 0; tries < 40; tries++) {
      const ang = Math.random() * Math.PI * 2
      const d = 70 + Math.random() * 40
      const x = playerState.x + Math.cos(ang) * d
      const z = playerState.z + Math.sin(ang) * d
      if (!world.collides(x, z)) {
        px = x
        pz = z
        break
      }
    }
    playerControl.x = px
    playerControl.z = pz
    playerControl.respawnSeq++
    // Park the entity far from the new spawn and reset it to a calm wander.
    const ang = Math.random() * Math.PI * 2
    epos.current.x = px + Math.cos(ang) * 45
    epos.current.z = pz + Math.sin(ang) * 45
    mode.current = 'wander'
    path.current = []
    spawnT.current = 8
    started.current = false
    entityState.active = false
    menace.current = 0
    boldness.current = 0
    // A catch buys only a brief reprieve — the dread floor stays high, so the next
    // encounter rebuilds fast. The hunt is delayed, never escaped.
    dread.current = Math.max(0, dread.current - 0.3)
    quietT.current = 0
    interceptCd.current = 6
    farT.current = 0
    teleCd.current = 7
    seenCalm.current = 0
    observedT.current = 0
    vanishT.current = 0
    huntFx.level = 0
    mat.opacity = 0.96
  }

  useFrame((state, delta) => {
    const cam = state.camera

    // Dormant until the player enters (or while paused) — but a death already in
    // progress always plays out. On the menu there is simply no entity, no presence.
    if (!gameState.playing && death.current.phase === 'none') {
      ref.current.visible = false
      entityState.active = false
      proximityFx.level = Math.max(0, proximityFx.level - delta * 4)
      huntFx.level = Math.max(0, huntFx.level - delta * 3)
      hum.setPresence(0)
      return
    }

    // --- Found-footage death ----------------------------------------------------
    // Three beats: the rig is forced to frame the entity (grab) → the camcorder
    // tumbles to the floor (fall) → it lies there a beat or two and then the signal
    // gives out (down → static). The Player rig reads deathCam.phase to animate the
    // camera; here we drive the timing, the entity's looming visibility and audio.
    const dth = death.current
    if (dth.phase !== 'none') {
      dth.t += delta
      // The chase panic FX winds down immediately once you're caught (and stays down
      // through the respawn), so the camera treatment never lingers after the hunt.
      huntFx.level = Math.max(0, huntFx.level - delta * 4)
      if (dth.phase === 'grab') {
        // It fills the frame, fully there, while the stinger hits. Heavy interference
        // but NOT static — you're made to see the thing.
        proximityFx.level = Math.min(0.8, proximityFx.level + delta * 4)
        hum.setPresence(0.9)
        mat.opacity = 0.99
        ref.current.position.set(deathCam.ex, 1.5, deathCam.ez)
        ref.current.rotation.y = Math.atan2(cam.position.x - deathCam.ex, cam.position.z - deathCam.ez)
        ref.current.visible = true
        entityState.active = false
        if (dth.t > GRAB_TIME) {
          dth.phase = 'fall'
          dth.t = 0
          deathCam.phase = 'fall'
        }
        return
      } else if (dth.phase === 'fall') {
        // It surges over the lens and fades out as the camera drops.
        proximityFx.level = Math.min(0.85, proximityFx.level + delta * 1.5)
        hum.setPresence(1)
        mat.opacity = Math.max(0, 0.99 - dth.t / DEATH_FALL)
        ref.current.position.set(deathCam.ex, 1.5, deathCam.ez)
        ref.current.rotation.y = Math.atan2(cam.position.x - deathCam.ex, cam.position.z - deathCam.ez)
        ref.current.visible = mat.opacity > 0.02
        entityState.active = false
        if (dth.t > DEATH_FALL) {
          dth.phase = 'down'
          dth.t = 0
          deathCam.phase = 'down'
          hum.cameraDrop() // it hits the carpet
        }
        return
      } else if (dth.phase === 'down') {
        ref.current.visible = false
        entityState.active = false
        if (dth.t < DOWN_TIME) {
          // On the floor, still recording — a sick, glitchy stillness.
          proximityFx.level += (0.3 - proximityFx.level) * Math.min(1, delta * 2)
          hum.setPresence(0.35)
        } else {
          // The signal finally gives out: kill the bed, blast static, crush to snow.
          if (signalFx.level < 0.001) hum.signalLost()
          proximityFx.level = Math.max(0, proximityFx.level - delta * 3)
          hum.setPresence(0)
          signalFx.level = Math.min(1, signalFx.level + delta * 4)
          if (signalFx.level >= 1 && dth.t > DOWN_TIME + 0.6) {
            respawnPlayer() // teleport hidden behind the static
            deathCam.active = false
            deathCam.phase = 'none'
            dth.phase = 'reboot'
            dth.t = 0
            signalFx.phase = 'reboot'
            hum.signalReboot()
          }
        }
        return
      } else {
        // reboot: camera powers back up at the new spot, static clears.
        signalFx.level = Math.max(0, signalFx.level - delta * 1.3)
        if (signalFx.level <= 0.01) {
          signalFx.level = 0
          signalFx.phase = 'live'
          playerControl.frozen = false
          playerState.alive = true
          dth.phase = 'none'
        }
        hum.setPresence(0)
        ref.current.visible = false
        entityState.active = false
        return
      }
    }

    // --- DEV summon: drop the entity ~9u away (in front of you, so it's visible)
    // and lock it onto you ----------------------------------------------------
    if (summon.current) {
      summon.current = false
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      f.y = 0
      if (f.lengthSq() < 1e-5) f.set(0, 0, -1)
      f.normalize()
      let sx = playerState.x + f.x * 9
      let sz = playerState.z + f.z * 9
      if (world.collides(sx, sz)) {
        sx = playerState.x + f.x * 5
        sz = playerState.z + f.z * 5
      }
      epos.current.x = sx
      epos.current.z = sz
      started.current = true
      spawnT.current = 0
      lastKnown.current.x = playerState.x
      lastKnown.current.z = playerState.z
      commit()
    }

    // --- Spawn grace: stay dormant briefly after (re)spawn -----------------------
    if (!started.current) {
      spawnT.current -= delta
      if (spawnT.current <= 0) {
        started.current = true
        // place the entity ~7–10 cells away so the Director can draw it in quickly
        const g = randomGoalNear(w2c(playerState.x), w2c(playerState.z), 7, 10)
        epos.current.x = c2w(g.x)
        epos.current.z = c2w(g.z)
        mode.current = 'wander'
        setGoal(...wanderGoalFrom())
      } else {
        ref.current.visible = false
        entityState.active = false
        proximityFx.level = Math.max(0, proximityFx.level - delta * 4)
        huntFx.level = Math.max(0, huntFx.level - delta * 4)
        hum.setPresence(0)
        return
      }
    }

    const px = playerState.x
    const pz = playerState.z
    const ex = epos.current.x
    const ez = epos.current.z
    const dx = px - ex
    const dz = pz - ez
    const dist = Math.hypot(dx, dz)
    entityState.x = ex
    entityState.z = ez
    entityState.dist = dist
    entityState.active = true
    entityState.mode = mode.current === 'stalk' ? 'investigate' : mode.current

    // --- Track your velocity/heading (for prediction, flanking and search) ----------
    if (playerControl.respawnSeq !== lastRespawnSeq.current) {
      // You were just teleported on respawn — don't read that jump as a velocity.
      lastRespawnSeq.current = playerControl.respawnSeq
      playerPrev.current.x = px
      playerPrev.current.z = pz
      pvel.current.x = 0
      pvel.current.z = 0
    }
    if (delta > 0) {
      const ivx = (px - playerPrev.current.x) / delta
      const ivz = (pz - playerPrev.current.z) / delta
      const sm = Math.min(1, delta * 6)
      pvel.current.x += (ivx - pvel.current.x) * sm
      pvel.current.z += (ivz - pvel.current.z) * sm
    }
    playerPrev.current.x = px
    playerPrev.current.z = pz

    // --- Dread climbs and never falls: the hunt only ever tightens -------------------
    const roaming = Math.hypot(pvel.current.x, pvel.current.z) > 0.6
    dread.current = Math.min(1, dread.current + delta * (DREAD_RATE + (roaming ? DREAD_MOVE : 0)))

    // The disturbance it radiates: a presence field that reaches far (any mode) and
    // grows as it draws near and as dread mounts — read by Fixtures so the lights in
    // its vicinity stutter, surge and gutter. A tell you learn to dread: the building
    // itself convulses where the thing is, long before you ever see it.
    const auraTarget = Math.max(0, 1 - dist / 30) * (0.7 + dread.current * 0.3)
    entityState.aura += (auraTarget - entityState.aura) * Math.min(1, delta * 3)

    // --- Perception -------------------------------------------------------------
    const canSee = dist < SIGHT && losClear(ex, ez, px, pz)
    // It hunts by sound: a louder intruder is heard from much further. Creeping (Ctrl)
    // shrinks the radius to almost nothing; sprinting broadcasts your position.
    const hearR = HEAR_BASE + playerState.noise * HEAR_GAIN
    const canHear = playerState.noise > 0.05 && dist < hearR

    // Are you looking at it? (used so it grows bolder when your back is turned.)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    fwd.y = 0
    const fl = Math.hypot(fwd.x, fwd.z) || 1
    const fwx = fwd.x / fl
    const fwz = fwd.z / fl
    // Stereo bearing of the entity relative to where you're facing (−1 left … +1 right),
    // used to place its footsteps/breath in the mix. right = forward × up = (−fwz, fwx).
    const ux = dist > 0.001 ? (ex - px) / dist : 0
    const uz = dist > 0.001 ? (ez - pz) / dist : 0
    const entPan = Math.max(-1, Math.min(1, ux * -fwz + uz * fwx))
    const aim = dist > 0.001 ? fwx * (dx / dist) + fwz * (dz / dist) : -1
    const lookingAt = aim > 0.5

    // Are you actually WATCHING it? (close enough + centred in your view + a clear
    // sightline). Its powers switch off the instant this is true.
    const observedNow = dist < OBSERVE_DIST && aim > OBSERVE_DOT && losClear(ex, ez, px, pz)
    if (observedNow) {
      observedT.current += delta
      seenCalm.current = SEEN_CALM
    } else {
      observedT.current = 0
      seenCalm.current = Math.max(0, seenCalm.current - delta)
    }
    teleCd.current -= delta
    if (lullT.current > 0) lullT.current -= delta
    // Your one piece of agency: stay out of sight AND quiet and the trail goes cold.
    // Being seen or making noise resets it instantly.
    if (!canSee && playerState.noise < 0.2) quietT.current += delta
    else quietT.current = 0

    // --- Director: omniscient menace ----------------------------------------------
    const nearFrac = Math.max(0, Math.min(1, (AWARE - dist) / AWARE))
    if (dist < AWARE) {
      menace.current = Math.min(1, menace.current + delta * (0.03 + 0.06 * nearFrac))
    } else {
      menace.current = Math.max(0, menace.current - delta * 0.02)
    }
    // While disengaged it actively cools off, so it won't immediately re-commit.
    if (lullT.current > 0) menace.current = Math.max(0, menace.current - delta * 0.12)
    // The dread floor: late in the night menace can no longer fully subside, so the
    // pressure to attack keeps building toward the inevitable.
    menace.current = Math.max(menace.current, dread.current * 0.55)

    // --- Paranormal powers (UNOBSERVED only, never in chase) ----------------------
    // It only ever relocates to a spot you currently have NO line of sight to (a wall
    // between you). Because line of sight depends on where you stand, not where you
    // look, a camera turn can never reveal a freshly-blinked entity — you only find
    // it by walking around a corner. So it can vanish the instant you look away and
    // be waiting past the next pillar, without ever cheaply popping into a turn.
    const canUsePowers = mode.current !== 'chase' && !observedNow && lullT.current <= 0
    // The "vanish": shortly after you look away, blink to an occluded spot — you turn
    // back and it's gone; then you round a pillar and it's there, watching.
    if (canUsePowers && wasObserved.current && teleCd.current <= 0 && vanishT.current <= 0) {
      vanishT.current = 0.4 + Math.random() * 0.5
    }
    wasObserved.current = observedNow
    if (vanishT.current > 0) {
      vanishT.current -= delta
      if (vanishT.current <= 0 && canUsePowers && teleCd.current <= 0) {
        teleport(px, pz, false)
      }
    }
    // Opportunistic "relocate": now and then, while it's well away and you can't see
    // it and you're not freshly spooked, it blinks to a new hiding spot.
    if (
      canUsePowers &&
      seenCalm.current <= 0 &&
      teleCd.current <= 0 &&
      dist > LURK_MIN_DIST &&
      Math.random() < delta / LURK_AVG
    ) {
      teleport(px, pz, true)
    }

    // --- FSM --------------------------------------------------------------------
    if (mode.current === 'wander') {
      if (lullT.current > 0) {
        // Disengaged: it has lost interest for a beat. Only getting close AND in its
        // line of sight (or a loud sprint nearby) snaps it back early — otherwise it
        // keeps drifting off and lets the dread rebuild.
        if (canSee && dist < 12) {
          lullT.current = 0
          mode.current = 'stalk'
          stalkPhase.current = 'approach'
          pickStalkSpot()
        } else if (canHear && playerState.sprint) {
          lullT.current = 0
          mode.current = 'investigate'
          lastKnown.current.x = px
          lastKnown.current.z = pz
          setGoal(w2c(px), w2c(pz))
        }
      } else if (canSee || dist < AWARE) {
        mode.current = 'stalk'
        stalkPhase.current = 'approach'
        pickStalkSpot()
      } else if (canHear) {
        mode.current = 'investigate'
        lastKnown.current.x = px
        lastKnown.current.z = pz
        setGoal(w2c(px), w2c(pz))
      }
    } else if (mode.current === 'investigate') {
      if (dist < AWARE) {
        mode.current = 'stalk'
        stalkPhase.current = 'approach'
        pickStalkSpot()
      } else if (Math.hypot(ex - lastKnown.current.x, ez - lastKnown.current.z) < 1.6) {
        mode.current = 'search'
        searchT.current = SEARCH_TIME
      }
    } else if (mode.current === 'stalk') {
      // Lose interest if you get well away and stay away for a few seconds.
      if (dist > FORGET) {
        farT.current += delta
        if (farT.current > 4) {
          // Lost you for good this pass → disengage and wander off for a while.
          mode.current = 'wander'
          lullT.current = 7 + Math.random() * 6
          setLullGoal()
        }
      } else {
        farT.current = 0
      }

      // Commit overrides / watched behaviour:
      if (menace.current >= 0.97 && dist < SIGHT && losClear(ex, ez, px, pz)) {
        // It has built up too much pressure — it lunges even as you stare it down.
        // (A long, tense build, so staring buys time but never freezes it forever.)
        commit()
      } else if (observedNow && observedT.current >= SEEN_LINGER && stalkPhase.current !== 'retreat') {
        // You've held it in your gaze a moment: it yields and slips slowly back into
        // the dark ("se aleja lentamente"). It speeds off only once you look away.
        stalkPhase.current = 'retreat'
        const g = randomGoalNear(w2c(px), w2c(pz), 4, 8)
        setGoal(g.x, g.z)
      } else if (canSee && !observedNow && boldness.current >= COMMIT_BOLD && menace.current >= 0.6) {
        // It can see you, your back is turned, and it's bold enough → it pounces.
        commit()
      } else if (stalkPhase.current === 'approach') {
        // Keep the stalk spot tracking you as you move.
        refreshT.current -= delta
        if (refreshT.current <= 0) {
          pickStalkSpot()
        }
        const atSpot = Math.hypot(ex - stalkSpot.current.x, ez - stalkSpot.current.z) < 1.6
        if (atSpot || dist < STALK_NEAR) {
          // You got close / it reached cover: if it's nervy enough it pounces,
          // otherwise it watches (peek). Walking right into it triggers a reaction.
          if (dist < CATCH + 1.4 && boldness.current >= COMMIT_BOLD && menace.current >= 0.5) {
            commit()
          } else {
            stalkPhase.current = 'peek'
            peekT.current = PEEK_TIME
          }
        }
      } else if (stalkPhase.current === 'peek') {
        peekT.current -= delta
        // Boldness climbs while it studies you — much faster behind your back.
        boldness.current = Math.min(1.4, boldness.current + delta * (lookingAt ? 0.06 : 0.2) * (0.5 + nearFrac))
        if (boldness.current >= COMMIT_BOLD && menace.current >= 0.6) {
          commit()
        } else if (peekT.current <= 0) {
          if (menace.current >= 0.9) {
            commit() // it's been long enough — it goes for you
          } else {
            // Approached, watched… now it bolts away again (and steels itself).
            stalkPhase.current = 'retreat'
            const g = randomGoalNear(w2c(px), w2c(pz), 3, 5)
            setGoal(g.x, g.z)
            boldness.current = Math.max(0, boldness.current - 0.1)
          }
        }
      } else {
        // retreat: once it's backed off, sidle in again from a fresh angle.
        const done = (path.current.length > 0 && pathIdx.current >= path.current.length) || dist > STALK_FAR
        if (done) {
          stalkPhase.current = 'approach'
          pickStalkSpot()
        }
      }
    } else if (mode.current === 'chase') {
      if (canSee) {
        lastKnown.current.x = px
        lastKnown.current.z = pz
        loseT.current = 0
      } else {
        // Out of sight: you lose it FAST if you go quiet (relief), but a loud or
        // recently-seen target keeps the lock. On giving up the chase it strikes out
        // for where you were HEADED, not just where you vanished.
        loseT.current += delta * (playerState.noise < 0.2 ? 1.5 : 0.7)
        if (loseT.current > LOSE_TIME) {
          mode.current = 'search'
          searchT.current = SEARCH_TIME
          const lead = 2 + dread.current * 2
          lastKnown.current.x += pvel.current.x * lead
          lastKnown.current.z += pvel.current.z * lead
          setGoal(w2c(lastKnown.current.x), w2c(lastKnown.current.z))
        }
      }
      if (dist < CATCH) {
        // CAUGHT — force the camera to frame the entity, slam the stinger, then the
        // camcorder is dropped (Player rig handles the look/fall via deathCam.phase).
        death.current.phase = 'grab'
        death.current.t = 0
        deathCam.active = true
        deathCam.phase = 'grab'
        deathCam.dir = Math.random() < 0.5 ? -1 : 1
        deathCam.ex = ex
        deathCam.ez = ez
        deathCam.ey = 1.7
        signalFx.phase = 'lost'
        playerControl.frozen = true
        playerState.alive = false
        hum.caught() // loud, terrifying
        return
      }
    } else if (mode.current === 'search') {
      searchT.current -= delta
      const atLast = Math.hypot(ex - lastKnown.current.x, ez - lastKnown.current.z) < 1.8
      if (canSee || dist < AWARE) {
        mode.current = 'stalk'
        stalkPhase.current = 'approach'
        pickStalkSpot()
      } else if (canHear) {
        mode.current = 'investigate'
        lastKnown.current.x = px
        lastKnown.current.z = pz
        setGoal(w2c(px), w2c(pz))
      } else if (atLast && searchT.current > 0) {
        // Reached where it reckoned you'd be and you're not there: cast forward along
        // your heading and sweep an adjacent room, rather than just giving up on the
        // spot. It knows the building — it checks where you'd logically have gone.
        const lead = 4 + Math.random() * 4
        const gx = w2c(lastKnown.current.x + pvel.current.x * lead + (Math.random() - 0.5) * 6)
        const gz = w2c(lastKnown.current.z + pvel.current.z * lead + (Math.random() - 0.5) * 6)
        const g = walkable(gx, gz) ? { x: gx, z: gz } : randomGoalNear(w2c(ex), w2c(ez), 4, 8)
        lastKnown.current.x = c2w(g.x)
        lastKnown.current.z = c2w(g.z)
        setGoal(g.x, g.z)
      } else if (searchT.current <= 0) {
        // Trail's cold: it disengages and lets dread rebuild — but the higher the
        // dread, the shorter the reprieve and the less often it bothers to break off.
        mode.current = 'wander'
        if (Math.random() < 0.4 - dread.current * 0.3) {
          lullT.current = (6 + Math.random() * 4) * (1 - dread.current * 0.6)
          setLullGoal()
        } else {
          setGoal(...wanderGoalFrom())
        }
      }
    }

    // --- Repathing --------------------------------------------------------------
    repathT.current -= delta
    const needRepath =
      repathT.current <= 0 ||
      (path.current.length > 0 && pathIdx.current >= path.current.length)
    if (mode.current === 'chase' && needRepath) {
      // Repath on the timer only (never every frame — see the freeze fix). Now and
      // then, while it can't see you, it cuts to where you're HEADED instead of your
      // current spot, to flank you and appear around the next corner.
      interceptCd.current -= REPATH
      if (interceptCd.current <= 0 && !canSee && Math.hypot(pvel.current.x, pvel.current.z) > 1) {
        interceptCd.current = 5 + Math.random() * 4
        setGoal(...interceptGoal())
      } else {
        setGoal(w2c(px), w2c(pz))
      }
    } else if (mode.current === 'investigate' && needRepath) {
      setGoal(w2c(lastKnown.current.x), w2c(lastKnown.current.z))
    } else if (mode.current === 'stalk' && stalkPhase.current === 'approach' && needRepath) {
      setGoal(w2c(stalkSpot.current.x), w2c(stalkSpot.current.z))
    } else if (mode.current === 'wander' && needRepath) {
      if (lullT.current > 0) {
        // drifted to the disengage spot → pick another one further off, keep leaving
        setLullGoal()
      } else {
        // The Director never loses you: it prowls toward your live position, and when
        // it's already close enough it periodically heads you off (flanks) to be
        // waiting up ahead. Far behind, it just bee-lines for you to close the gap.
        interceptCd.current -= REPATH
        if (interceptCd.current <= 0 && dist < 28 && Math.hypot(pvel.current.x, pvel.current.z) > 1) {
          interceptCd.current = 6 + Math.random() * 5
          setGoal(...interceptGoal())
        } else {
          setGoal(...wanderGoalFrom())
        }
      }
    } else if (mode.current === 'search' && needRepath) {
      setGoal(w2c(lastKnown.current.x), w2c(lastKnown.current.z))
    }

    // --- Movement along the path ------------------------------------------------
    const peeking = mode.current === 'stalk' && stalkPhase.current === 'peek'
    if (!peeking) {
      let spd = mode.current === 'stalk' ? STALK_SPD[stalkPhase.current] : SPD[mode.current]
      // Dread quickens the hunt as the night wears on — by late game a committed
      // chase edges past your sprint, so outrunning it stops being an option.
      if (mode.current === 'chase' || (mode.current === 'stalk' && stalkPhase.current === 'approach')) {
        spd *= 1 + dread.current * 0.18
      }
      // The core of the "paranormal but realistic" rule: it only ever moves quickly
      // while you CAN'T see it. The instant you watch it, it nearly stops (it watches
      // back); just after you've seen it, it moves calmly and slow; and while unseen
      // it may lope/haste into position, so it always seems to be wherever you look.
      if (mode.current !== 'chase') {
        if (observedNow) {
          // You're watching it: it all but freezes and stares back ("te observa").
          spd = Math.min(spd, 0.25)
        } else if (seenCalm.current > 0) {
          // Just after you've seen it, it moves calmly and slow (the "se aleja
          // lentamente" backing-off read).
          spd = Math.min(spd, 1.4)
        } else if (
          mode.current === 'wander' ||
          mode.current === 'investigate' ||
          (mode.current === 'stalk' && stalkPhase.current === 'approach')
        ) {
          // Unseen: the further off you are, the faster it reels you in off-camera —
          // it always knows where you are and you cannot outrun what stalks you through
          // the walls. Close range it eases back to the eerie creep so it never just
          // barrels into view. ~3 m/s on top of you → ~6.5+ m/s far away (well past
          // your sprint), more as dread mounts.
          const t = Math.min(1, Math.max(0, (dist - 8) / 18)) // 0 at ≤8m → 1 at ≥26m
          spd = Math.max(spd * 1.45, 3.0 + t * (3.4 + dread.current * 1.8))
        }
      }
      let target = path.current[pathIdx.current]
      // Final approach: while chasing with a clear line of sight, home straight on
      // the player's REAL position. Cell-centre waypoints alone leave it up to ~a
      // cell short of the catch radius, so without this it could never reach you.
      if (mode.current === 'chase' && dist < 9 && losClear(ex, ez, px, pz)) {
        target = { x: px, z: pz }
      } else if (!target) {
        // No path → ease directly toward goal cell centre (rare fallback).
        target = { x: c2w(goalCell.current.x), z: c2w(goalCell.current.z) }
      }
      const tdx = target.x - ex
      const tdz = target.z - ez
      const tdist = Math.hypot(tdx, tdz)
      if (tdist < 0.25) {
        pathIdx.current++
      } else {
        const stepLen = Math.min(tdist, spd * delta)
        const nx = ex + (tdx / tdist) * stepLen
        const nz = ez + (tdz / tdist) * stepLen
        if (!world.collides(nx, nz)) {
          epos.current.x = nx
          epos.current.z = nz
        } else {
          // bumped a pillar (shouldn't on a valid path) → force a repath next frame
          repathT.current = 0
        }
      }
    }

    // --- Locatable audio: footfalls + the odd breath, panned to its real bearing ---
    // You hear it move (and roughly where) before and without ever seeing it. Steps
    // fire per distance travelled, so the cadence matches its speed; quieter the
    // further off, near-silent while it freezes under your gaze, heavier mid-chase.
    const AUDIBLE = 20
    if (dist < AUDIBLE && death.current.phase === 'none') {
      const moved = Math.hypot(epos.current.x - ex, epos.current.z - ez)
      stepDist.current += moved
      const stride = 0.85 + Math.random() * 0.15
      if (stepDist.current >= stride) {
        stepDist.current = 0
        const near = 1 - dist / AUDIBLE
        // Much more present now: a clearly audible pad even at mid-range, heavy in a
        // chase. You should always be able to hear it moving around you.
        let g = 0.5 + near * near * 1.4
        if (mode.current === 'chase') g *= 1.7
        else if (observedNow) g *= 0.6
        hum.entityStep(entPan, g)
      }
    }
    breathCd.current -= delta
    // The breath is a real "it's right there, unseen" tell — audible, and it can stir
    // whenever it's prowling close by out of sight (stalking OR wandering near you),
    // not only deep in a stalk. Fires often enough to actually land.
    if (
      !observedNow &&
      dist > 2.5 &&
      dist < 13 &&
      breathCd.current <= 0 &&
      (mode.current === 'stalk' || mode.current === 'wander' || mode.current === 'investigate')
    ) {
      hum.entityBreath(entPan, 0.12 + (1 - dist / 13) * 0.18)
      breathCd.current = 3.5 + Math.random() * 4
    }

    // --- Proximity interference + presence (you feel it before you see it) -------
    let proxTarget = 0
    if (dist < PROX_FX) {
      const f = (PROX_FX - dist) / PROX_FX // 0..1, 1 right on top of you
      proxTarget = f * f // faint while it circles at 6–10m, climbs as it crowds you
      if (mode.current === 'chase') proxTarget = Math.max(proxTarget, 0.4 + f * 0.5)
    }
    proximityFx.level += (proxTarget - proximityFx.level) * Math.min(1, delta * 5)
    hum.setPresence(proximityFx.level)

    // --- Hunt panic FX ramp: high while chasing, decays once the chase ends -------
    const huntTarget = mode.current === 'chase' ? 1 : 0
    huntFx.level += (huntTarget - huntFx.level) * Math.min(1, delta * (huntTarget > huntFx.level ? 8 : 2))

    // --- Render: a flat silhouette billboard that ALWAYS squares up to the camera.
    // The entity is a 2D cut-out, not a 3D body, so it must never be seen edge-on
    // (that collapses it to a sliver/thread). Facing the camera every frame keeps its
    // full width and mass from any angle. ---
    faceYaw.current = Math.atan2(cam.position.x - epos.current.x, cam.position.z - epos.current.z)
    ref.current.position.set(epos.current.x, 1.35, epos.current.z)
    ref.current.rotation.y = faceYaw.current
    ref.current.visible = true
  })

  return (
    <group ref={ref} visible={false}>
      <mesh geometry={geom} material={mat} frustumCulled={false} />
    </group>
  )
}
