import { useRef, useState } from 'react'
import { touchInput } from '../game/retro'

// On-screen controls for touch devices: a left analog joystick for movement, a
// right-side drag area for looking, and toggle buttons for run/stealth. Toggles
// (not hold) so you can keep your thumb free to look while running. Run and
// stealth are mutually exclusive. Everything writes into the shared `touchInput`
// channel that the Player rig reads each frame.
const JOY_R = 55 // px radius of the joystick travel

export function TouchControls() {
  const [sprint, setSprint] = useState(false)
  const [creep, setCreep] = useState(false)

  const toggleSprint = () => {
    const next = !sprint
    setSprint(next)
    touchInput.sprint = next
    if (next && creep) { setCreep(false); touchInput.creep = false }
  }
  const toggleCreep = () => {
    const next = !creep
    setCreep(next)
    touchInput.creep = next
    if (next && sprint) { setSprint(false); touchInput.sprint = false }
  }

  const joyId = useRef<number | null>(null)
  const joyOrigin = useRef({ x: 0, y: 0 })
  const knob = useRef<HTMLDivElement>(null)
  const lookId = useRef<number | null>(null)
  const lookPrev = useRef({ x: 0, y: 0 })

  const joyStart = (e: React.PointerEvent) => {
    joyId.current = e.pointerId
    joyOrigin.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const joyMove = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current) return
    let dx = e.clientX - joyOrigin.current.x
    let dy = e.clientY - joyOrigin.current.y
    const len = Math.hypot(dx, dy)
    if (len > JOY_R) { dx = (dx / len) * JOY_R; dy = (dy / len) * JOY_R }
    touchInput.mvX = dx / JOY_R
    touchInput.mvY = -dy / JOY_R
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const joyEnd = (e: React.PointerEvent) => {
    if (e.pointerId !== joyId.current) return
    joyId.current = null
    touchInput.mvX = 0
    touchInput.mvY = 0
    if (knob.current) knob.current.style.transform = 'translate(0px, 0px)'
  }

  const lookStart = (e: React.PointerEvent) => {
    if (lookId.current !== null) return
    lookId.current = e.pointerId
    lookPrev.current = { x: e.clientX, y: e.clientY }
  }
  const lookMove = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return
    touchInput.lookDX += e.clientX - lookPrev.current.x
    touchInput.lookDY += e.clientY - lookPrev.current.y
    lookPrev.current = { x: e.clientX, y: e.clientY }
  }
  const lookEnd = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return
    lookId.current = null
  }

  return (
    <div className="touch">
      <div
        className="touch-look"
        onPointerDown={lookStart}
        onPointerMove={lookMove}
        onPointerUp={lookEnd}
        onPointerCancel={lookEnd}
      />
      <div
        className="touch-joy"
        onPointerDown={joyStart}
        onPointerMove={joyMove}
        onPointerUp={joyEnd}
        onPointerCancel={joyEnd}
      >
        <div className="touch-joy-knob" ref={knob} />
      </div>
      <button
        className={`touch-btn touch-run${sprint ? ' on' : ''}`}
        onPointerDown={(e) => { e.preventDefault(); toggleSprint() }}
      >
        CORRER
      </button>
      <button
        className={`touch-btn touch-creep${creep ? ' on' : ''}`}
        onPointerDown={(e) => { e.preventDefault(); toggleCreep() }}
      >
        SIGILO
      </button>
    </div>
  )
}
