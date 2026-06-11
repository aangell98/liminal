import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './game/Scene'
import { Overlay } from './ui/Overlay'
import { CameraHUD } from './ui/CameraHUD'
import { createWorld } from './game/maze'
import { createHum } from './game/audio'
import { gameState } from './game/retro'

export default function App() {
  const world = useMemo(() => createWorld(20240610), [])
  const hum = useMemo(() => createHum(), [])
  const controlsRef = useRef<{ lock: () => void } | null>(null)
  const [started, setStarted] = useState(false)
  const [locked, setLocked] = useState(false)

  const enter = () => {
    hum.start()
    setStarted(true)
    controlsRef.current?.lock()
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
      {!locked && <Overlay started={started} onEnter={enter} />}
    </div>
  )
}
