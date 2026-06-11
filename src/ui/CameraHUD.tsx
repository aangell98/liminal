import { useEffect, useRef, useState } from 'react'
import { hudState, signalFx } from '../game/retro'

const pad = (n: number) => n.toString().padStart(2, '0')

// Crisp camcorder-style overlay: viewfinder frame, blinking REC + record timecode,
// live date/time, battery and a centre focus reticle. Pure HTML/CSS over the canvas.
export function CameraHUD() {
  const [now, setNow] = useState(() => new Date())
  const [rec, setRec] = useState('00:00:00')
  const [low, setLow] = useState(false)
  const [signal, setSignal] = useState<'live' | 'lost' | 'reboot'>('live')
  const start = useRef(performance.now())

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date())
      const s = Math.floor((performance.now() - start.current) / 1000)
      setRec(`${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`)
      setLow(hudState.lowLight)
      setSignal(signalFx.phase)
    }, 120)
    return () => window.clearInterval(id)
  }, [])

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  // When the entity catches you the tape loses signal; the HUD breaks up to match.
  if (signal !== 'live') {
    return (
      <div className="cam-hud">
        <div className="cam-scanlines" />
        <div className="cam-nosignal">
          <span className="dot off" /> {signal === 'reboot' ? '◐ REC ⏻' : '⚠ NO SIGNAL'}
        </div>
        <div className="cam-tracking">{signal === 'reboot' ? 'PLAY ▶' : '▮▮ TRACKING ▮▮'}</div>
        <div className="cam-time err">--:--:--</div>
      </div>
    )
  }

  return (
    <div className="cam-hud">
      <div className="cam-scanlines" />

      <span className="b tl" />
      <span className="b tr" />
      <span className="b bl" />
      <span className="b br" />

      <div className="cam-rec">
        <span className="dot" /> REC <span className="tc">{rec}</span>
      </div>
      <div className="cam-bat">▮▮▮▯ SP</div>
      <div className="cam-id">CAM 01</div>
      {low && <div className="cam-low">◐ LOW LIGHT</div>}

      <div className="reticle" />

      <div className="cam-date">{date}</div>
      <div className="cam-time">{time}</div>
    </div>
  )
}
