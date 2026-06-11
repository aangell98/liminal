import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './game/Scene'
import { Overlay } from './ui/Overlay'
import { CameraHUD } from './ui/CameraHUD'
import { TouchControls } from './ui/TouchControls'
import { createWorld } from './game/maze'
import { createHum } from './game/audio'
import { gameState, touchInput } from './game/retro'

export default function App() {
  const world = useMemo(() => createWorld(20240610), [])
  const hum = useMemo(() => createHum(), [])
  const controlsRef = useRef<{ lock: () => void } | null>(null)
  const [started, setStarted] = useState(false)
  const [locked, setLocked] = useState(false)
  // Touch devices can't use pointer lock, so they get on-screen controls and start
  // the game directly instead of requesting a lock.
  const isTouch = useMemo(
    () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window),
    [],
  )

  const enter = () => {
    hum.start()
    setStarted(true)
    if (isTouch) {
      touchInput.active = true
      setLocked(true)
      gameState.playing = true // no pointer lock on mobile: drop straight into the hunt
    } else {
      controlsRef.current?.lock()
    }
  }

  return (
    <div className="app">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 75, near: 0.1, far: 90, position: [0, 1.6, 0] }}
        gl={{ antialias: true }}
      >
        <Scene
          world={world}
          hum={hum}
          controlsRef={controlsRef}
          onLock={() => {
            setLocked(true)
            gameState.playing = true // the hunt only runs once you're truly in
          }}
          onUnlock={() => {
            setLocked(false)
            gameState.playing = false // Esc/pause freezes the experience
          }}
        />
      </Canvas>

      {locked && <CameraHUD />}
      {locked && isTouch && <TouchControls />}
      {!locked && <Overlay started={started} onEnter={enter} mobile={isTouch} />}
    </div>
  )
}
