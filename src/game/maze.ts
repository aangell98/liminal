// ---------------------------------------------------------------------------
// Level 0 — "the office, reimagined a thousand times until it stopped meaning
// anything". An infinite, deterministic floorplan of mono-yellow rooms of every
// proportion, partition walls with doorways, and long nonsensical corridors.
//
// Geometry model: walls live on the EDGES between cells (thin office partitions),
// not as fat blocks. Everything is a pure function of integer cell coordinates +
// the seed, so the world is endless with no stored grid:
//   • Vertical partition LINES fall on certain column boundaries (irregular
//     spacing → rooms of widely varying width); same for horizontal lines.
//   • Along a present line the wall is broken into SEGMENTS, a fraction of which
//     are missing → adjacent rooms merge into big/L-shaped spaces and atriums.
//   • Present wall segments are punched with regular DOORWAYS (plus the odd extra
//     gap) which guarantees the whole plane stays connected.
// A 1-cell-wide room between two partition lines reads as a corridor, so long
// hallways emerge naturally; aligned doorways open up long sightlines.
// ---------------------------------------------------------------------------

export interface Prop {
  x: number
  z: number
  rot: number
  type: 'chairpile' | 'desk' | 'cabinet' | 'chairs'
  seed: number
}

export interface World {
  CELL: number
  WALL_H: number
  WALL_T: number
  COL_W: number
  RENDER_RADIUS: number
  spawn: { x: number; z: number }
  worldToCell: (v: number) => number
  cellToWorld: (c: number) => number
  isWall: (gx: number, gz: number) => boolean // solid support-column cell (entity routes around it)
  wallV: (gx: number, gz: number) => boolean // wall on the EAST edge of cell (gx,gz)
  wallH: (gx: number, gz: number) => boolean // wall on the NORTH edge of cell (gx,gz)
  wallBetween: (ax: number, az: number, bx: number, bz: number) => boolean
  collides: (x: number, z: number) => boolean
  prop: (gx: number, gz: number) => Prop | null
  wallsAround: (
    pcx: number,
    pcz: number,
    outV: { x: number; z: number }[],
    outH: { x: number; z: number }[],
  ) => { nv: number; nh: number }
  propsAround: (pcx: number, pcz: number, out: Prop[]) => number
  columnsAround: (pcx: number, pcz: number, out: { x: number; z: number }[]) => number
}

const CELL = 5
const WALL_H = 3.0
const WALL_T = 0.34
const PLAYER_R = 0.35
const COL_W = 1.0 // iconic square support columns (solid, floor-to-ceiling)
const RENDER_RADIUS = 11 // cells; matches fog reach so geometry never pops in

// --- Layout tuning ---------------------------------------------------------
// Dense partitioning is deliberate: tight rooms and long narrow corridors so the
// place feels enclosed and you feel trapped, not adrift in open space.
const PV = 0.6 // chance a column boundary is a vertical partition line (per block)
const PH = 0.6 // chance a row boundary is a horizontal partition line (per block)
const SEG = 4 // wall-segment length (cells) for merge gaps
const MERGE = 0.1 // fraction of segments left OPEN (rooms merge / openings)
const DOOR = 3 // a doorway every DOOR cells along a present wall
const EXTRA_DOOR = 0.05 // extra random openings on top of the regular doors
const LBLK = 5 // partition lines are localized to ~LBLK-cell blocks (finite walls)
const PROP_CHANCE = 0.08 // chance a floor cell holds a piece of clutter
const COL_CHANCE = 0.3 // chance an OPEN room cell hosts a support column
const SPAWN_CLEAR = 1 // cells around origin kept open (tight spawn alcove, not a hall)

// Deterministic 32-bit integer hash → [0,1). Pure function of its inputs.
function hash2(x: number, z: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, -1640531527)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function ihash(n: number, seed: number) {
  let h = Math.imul(n | 0, 2246822519) ^ Math.imul(seed | 0, 3266489917)
  h = Math.imul(h ^ (h >>> 15), 2654435761)
  return (h ^ (h >>> 16)) >>> 0
}

export function createWorld(seed = 1337): World {
  const SV = seed ^ 0x9e3779b9 // vertical lines
  const SH = seed ^ 0x85ebca6b // horizontal lines
  const SM = seed ^ 0xc2b2ae35 // merge segments
  const SD = seed ^ 0x27d4eb2f // door phase
  const SE = seed ^ 0x165667b1 // extra doors
  const SP = seed ^ 0x1f83d9ab // props
  const SC = seed ^ 0x2545f491 // support columns

  const worldToCell = (v: number) => Math.floor(v / CELL)
  const cellToWorld = (c: number) => (c + 0.5) * CELL

  const inSpawn = (gx: number, gz: number) =>
    gx >= -SPAWN_CLEAR && gx <= SPAWN_CLEAR && gz >= -SPAWN_CLEAR && gz <= SPAWN_CLEAR

  const fdiv = (a: number, b: number) => Math.floor(a / b)

  // Localized partition lines: a vertical line at column gx is "active" only within
  // certain z-blocks (length ~LBLK cells), so walls run for a finite stretch and
  // then stop, instead of striping the whole infinite plane. Same horizontally.
  const vLine = (gx: number, gz: number) => hash2(gx, fdiv(gz, LBLK), SV) < PV
  const hLine = (gx: number, gz: number) => hash2(fdiv(gx, LBLK), gz, SH) < PH

  // Is the wall structurally present (not a merge-gap) at this point on the line?
  const vSegPresent = (gx: number, gz: number) => {
    const phase = ihash(gx, SM) % SEG
    const segId = Math.floor((gz + phase) / SEG)
    return hash2(gx, segId, SM) >= MERGE
  }
  const hSegPresent = (gx: number, gz: number) => {
    const phase = ihash(gz, SM) % SEG
    const segId = Math.floor((gx + phase) / SEG)
    return hash2(segId, gz, SM) >= MERGE
  }

  // Is there a doorway here (so the wall is open at this cell)?
  const vDoor = (gx: number, gz: number) => {
    const phase = ihash(gx, SD) % DOOR
    if (((((gz + phase) % DOOR) + DOOR) % DOOR) === 0) return true
    return hash2(gx, gz, SE) < EXTRA_DOOR
  }
  const hDoor = (gx: number, gz: number) => {
    const phase = ihash(gz, SD) % DOOR
    if (((((gx + phase) % DOOR) + DOOR) % DOOR) === 0) return true
    return hash2(gx, gz, SE) < EXTRA_DOOR
  }

  // Wall on the EAST edge of cell (gx,gz) — between columns gx and gx+1.
  const wallV = (gx: number, gz: number) => {
    if (inSpawn(gx, gz) && inSpawn(gx + 1, gz)) return false
    if (!vLine(gx, gz)) return false
    if (!vSegPresent(gx, gz)) return false
    if (vDoor(gx, gz)) return false
    return true
  }
  // Wall on the NORTH edge of cell (gx,gz) — between rows gz and gz+1.
  const wallH = (gx: number, gz: number) => {
    if (inSpawn(gx, gz) && inSpawn(gx, gz + 1)) return false
    if (!hLine(gx, gz)) return false
    if (!hSegPresent(gx, gz)) return false
    if (hDoor(gx, gz)) return false
    return true
  }

  // A solid square support column standing in the middle of an OPEN room cell — the
  // iconic Backrooms pillar. Only in cells with no edge walls (so corridors and
  // doorways stay clear) and never at spawn. Exposed as isWall so the entity's A*
  // cleanly routes around the cell; collides + LOS treat the column box itself, so it
  // physically blocks movement and breaks sightlines (the entity can lurk behind one).
  // It only ever obstructs the cell centre, leaving wide margins to walk around.
  const colCell = (gx: number, gz: number) => {
    if (inSpawn(gx, gz)) return false
    if (hash2(gx, gz, SC) >= COL_CHANCE) return false
    if (wallV(gx, gz) || wallV(gx - 1, gz) || wallH(gx, gz) || wallH(gx, gz - 1)) return false
    return true
  }
  const isWall = colCell

  const wallBetween = (ax: number, az: number, bx: number, bz: number) => {
    if (bx === ax + 1 && bz === az) return wallV(ax, az)
    if (bx === ax - 1 && bz === az) return wallV(ax - 1, az)
    if (bz === az + 1 && bx === ax) return wallH(ax, az)
    if (bz === az - 1 && bx === ax) return wallH(ax, az - 1)
    return false
  }

  // Distance from a point to an axis-aligned box; <r ⇒ collision.
  const nearBox = (
    px: number,
    pz: number,
    minx: number,
    minz: number,
    maxx: number,
    maxz: number,
    r: number,
  ) => {
    const cx = px < minx ? minx : px > maxx ? maxx : px
    const cz = pz < minz ? minz : pz > maxz ? maxz : pz
    const dx = px - cx
    const dz = pz - cz
    return dx * dx + dz * dz < r * r
  }

  // Player/entity collision against the thin wall slabs of nearby cells. Slabs are
  // lengthened by WALL_T at both ends so wall corners are sealed (no diagonal leak).
  const collides = (x: number, z: number) => {
    const cx = worldToCell(x)
    const cz = worldToCell(z)
    const ht = WALL_T / 2
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const gx = cx + dx
        const gz = cz + dz
        if (wallV(gx, gz)) {
          const ex = (gx + 1) * CELL
          const z0 = gz * CELL - ht
          const z1 = (gz + 1) * CELL + ht
          if (nearBox(x, z, ex - ht, z0, ex + ht, z1, PLAYER_R)) return true
        }
        if (wallH(gx, gz)) {
          const ez = (gz + 1) * CELL
          const x0 = gx * CELL - ht
          const x1 = (gx + 1) * CELL + ht
          if (nearBox(x, z, x0, ez - ht, x1, ez + ht, PLAYER_R)) return true
        }
        if (colCell(gx, gz)) {
          const ccx = cellToWorld(gx)
          const ccz = cellToWorld(gz)
          const hw = COL_W / 2
          if (nearBox(x, z, ccx - hw, ccz - hw, ccx + hw, ccz + hw, PLAYER_R)) return true
        }
      }
    return false
  }

  // Deterministic clutter for a floor cell (or null). Furniture is pushed against
  // whichever wall the cell has, so it reads as office junk shoved to the edges of a
  // room. Open room cells are mostly left clear (for columns and breathing space),
  // bar the occasional toppled chair heap marooned in the middle.
  const prop = (gx: number, gz: number): Prop | null => {
    if (inSpawn(gx, gz)) return null
    if (colCell(gx, gz)) return null // a column owns this cell
    const r = hash2(gx, gz, SP)
    if (r >= PROP_CHANCE) return null
    const pick = hash2(gx, gz, SP ^ 0x51)
    const wN = wallH(gx, gz)
    const wS = wallH(gx, gz - 1)
    const wE = wallV(gx, gz)
    const wW = wallV(gx - 1, gz)
    const open = !wN && !wS && !wE && !wW
    const cxw = cellToWorld(gx)
    const czw = cellToWorld(gz)
    // Push the prop toward whichever wall the cell has (else leave it central).
    let ox = 0
    let oz = 0
    let rot = (hash2(gx, gz, SP ^ 0x77) - 0.5) * 0.5
    const push = CELL * 0.32
    if (wE) { ox = push; rot = Math.PI / 2 }
    else if (wW) { ox = -push; rot = -Math.PI / 2 }
    else if (wN) { oz = push; rot = 0 }
    else if (wS) { oz = -push; rot = Math.PI }
    let type: Prop['type']
    if (open) {
      if (pick >= 0.16) return null // keep open rooms mostly empty
      type = 'chairpile' // a lone heap stranded in the middle
    } else if (pick < 0.3) type = 'chairpile'
    else if (pick < 0.55) type = 'desk'
    else if (pick < 0.78) type = 'cabinet'
    else type = 'chairs'
    return { x: cxw + ox, z: czw + oz, rot, type, seed: (ihash(gx, SP) ^ ihash(gz, SP * 3)) >>> 0 }
  }

  const wallsAround = (
    pcx: number,
    pcz: number,
    outV: { x: number; z: number }[],
    outH: { x: number; z: number }[],
  ) => {
    let nv = 0
    let nh = 0
    for (let gx = pcx - RENDER_RADIUS; gx <= pcx + RENDER_RADIUS; gx++)
      for (let gz = pcz - RENDER_RADIUS; gz <= pcz + RENDER_RADIUS; gz++) {
        if (wallV(gx, gz) && nv < outV.length) {
          outV[nv].x = (gx + 1) * CELL
          outV[nv].z = (gz + 0.5) * CELL
          nv++
        }
        if (wallH(gx, gz) && nh < outH.length) {
          outH[nh].x = (gx + 0.5) * CELL
          outH[nh].z = (gz + 1) * CELL
          nh++
        }
      }
    return { nv, nh }
  }

  const propsAround = (pcx: number, pcz: number, out: Prop[]) => {
    let n = 0
    for (let gx = pcx - RENDER_RADIUS; gx <= pcx + RENDER_RADIUS; gx++)
      for (let gz = pcz - RENDER_RADIUS; gz <= pcz + RENDER_RADIUS; gz++) {
        const p = prop(gx, gz)
        if (p && n < out.length) {
          out[n] = p
          n++
        }
      }
    return n
  }

  const columnsAround = (pcx: number, pcz: number, out: { x: number; z: number }[]) => {
    let n = 0
    for (let gx = pcx - RENDER_RADIUS; gx <= pcx + RENDER_RADIUS; gx++)
      for (let gz = pcz - RENDER_RADIUS; gz <= pcz + RENDER_RADIUS; gz++) {
        if (colCell(gx, gz) && n < out.length) {
          out[n].x = cellToWorld(gx)
          out[n].z = cellToWorld(gz)
          n++
        }
      }
    return n
  }

  return {
    CELL,
    WALL_H,
    WALL_T,
    COL_W,
    RENDER_RADIUS,
    spawn: { x: 0, z: 0 },
    worldToCell,
    cellToWorld,
    isWall,
    wallV,
    wallH,
    wallBetween,
    collides,
    prop,
    wallsAround,
    propsAround,
    columnsAround,
  }
}
