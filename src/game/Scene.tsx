import type { MutableRefObject } from 'react'
import { Level0 } from './Level0'
import { Player } from './Player'
import { Dust } from './Dust'
import { Lighting } from './Lighting'
import { Fixtures } from './Fixtures'
import { Anomalies } from './Anomalies'
import { Entity } from './Entity'
import { Effects } from './Effects'
import type { World } from './maze'
import type { Hum } from './audio'

export function Scene({
  world,
  hum,
  controlsRef,
  onLock,
  onUnlock,
}: {
  world: World
  hum: Hum
  controlsRef: MutableRefObject<{ lock: () => void } | null>
  onLock: () => void
  onUnlock: () => void
}) {
  return (
    <>
      <color attach="background" args={['#a89850']} />
      <fogExp2 attach="fog" args={['#a89850', 0.045]} />

      <Lighting />

      <Level0 world={world} />
      <Fixtures world={world} hum={hum} />
      <Player world={world} hum={hum} lockRef={controlsRef} onLock={onLock} onUnlock={onUnlock} />
      <Dust />
      <Anomalies world={world} hum={hum} />
      <Entity world={world} hum={hum} />

      <Effects />
    </>
  )
}
