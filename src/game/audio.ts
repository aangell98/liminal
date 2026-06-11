// Procedurally generated soundscape — no audio files. Must be started from a user
// gesture (browsers block autoplay audio). Beyond the steady mains/fluorescent hum
// it exposes:
//   footstep() — a soft carpet step (the player triggers these on each head-bob dip)
//   setBuzz()  — a continuous electrical buzz whose level tracks nearby flickering
//                tubes, so a failing fluorescent overhead audibly sizzles
export function createHum() {
  let started = false
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let buzzGain: GainNode | null = null
  let reverbIn: GainNode | null = null // send bus → convolver reverb → master
  let laughBuffer: AudioBuffer | null = null // optional dropped-in laugh sample

  // Soft-saturation curve for the laugh's waveshaper — adds gritty harmonics so the
  // voice reads as distorted/wrong rather than a clean synth tone.
  const distCurve = (() => {
    const n = 1024
    const c = new Float32Array(n)
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 3.4)
    return c
  })()

  function start() {
    if (started) return
    started = true

    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctx()

    master = ctx.createGain()
    master.gain.value = 0.0001
    master.connect(ctx.destination)
    master.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 3)

    const addOsc = (freq: number, type: OscillatorType, gain: number) => {
      const o = ctx!.createOscillator()
      o.type = type
      o.frequency.value = freq
      const g = ctx!.createGain()
      g.gain.value = gain
      o.connect(g).connect(master!)
      o.start()
    }

    addOsc(32, 'sine', 0.16) // deep room tone
    addOsc(60, 'sine', 0.5) // mains hum fundamental
    addOsc(120, 'sine', 0.28) // first harmonic
    addOsc(8000, 'sine', 0.012) // faint high fluorescent whine

    // A quiet band-passed noise bed for "air".
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 900
    filter.Q.value = 0.6
    const ng = ctx.createGain()
    ng.gain.value = 0.02
    noise.connect(filter).connect(ng).connect(master)
    noise.start()

    // Persistent electrical buzz, gated by setBuzz() from nearby flickering tubes.
    const bo1 = ctx.createOscillator()
    bo1.type = 'sawtooth'
    bo1.frequency.value = 120
    const bo2 = ctx.createOscillator()
    bo2.type = 'square'
    bo2.frequency.value = 119.3 // slight detune for grit
    const bhp = ctx.createBiquadFilter()
    bhp.type = 'highpass'
    bhp.frequency.value = 850
    buzzGain = ctx.createGain()
    buzzGain.gain.value = 0
    bo1.connect(bhp)
    bo2.connect(bhp)
    bhp.connect(buzzGain).connect(master)
    bo1.start()
    bo2.start()

    // Shared reverb: a convolver fed by a procedurally-generated decaying-noise
    // impulse response gives a big, roomy tail. Anomaly sounds (the laugh, the
    // distant bang) send into it for an "echo everywhere" wash.
    const irLen = Math.floor(ctx.sampleRate * 3.2)
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 2.5
    }
    const convolver = ctx.createConvolver()
    convolver.buffer = ir
    reverbIn = ctx.createGain()
    reverbIn.gain.value = 1
    const reverbReturn = ctx.createGain()
    reverbReturn.gain.value = 0.9
    reverbIn.connect(convolver).connect(reverbReturn).connect(master)

    loadLaugh() // pull in a dropped-in laugh sample if the user added one
    scheduleSwell()
  }

  // Optionally load a real laugh recording from public/audio/ (laugh.mp3|ogg|wav).
  // If present it's played back distorted/pitched-down (creepyLaugh); if absent we
  // fall back to the fully-synthesized laugh. Drop your own file in to use it.
  async function loadLaugh() {
    if (!ctx) return
    for (const name of ['laugh.mp3', 'laugh.ogg', 'laugh.wav']) {
      try {
        const r = await fetch('audio/' + name)
        if (!r.ok) continue
        laughBuffer = await ctx.decodeAudioData(await r.arrayBuffer())
        return
      } catch {
        /* try the next extension, else stay on the synth fallback */
      }
    }
  }

  // Occasional distant low swell — an unsettling "something far off" room tone.
  function scheduleSwell() {
    const wait = (12 + Math.random() * 22) * 1000
    setTimeout(() => {
      if (!ctx || !master) return
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = 38 + Math.random() * 34
      const g = ctx.createGain()
      g.gain.value = 0
      o.connect(g).connect(master)
      const now = ctx.currentTime
      o.start()
      g.gain.linearRampToValueAtTime(0.05, now + 3)
      g.gain.linearRampToValueAtTime(0, now + 7)
      o.stop(now + 7.5)
      scheduleSwell()
    }, wait)
  }

  // Soft carpet footstep: a short, decaying low-passed noise thud.
  function footstep(gain = 0.4) {
    if (!ctx || !master) return
    const len = Math.floor(ctx.sampleRate * 0.13)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 430
    lp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(lp).connect(g).connect(master)
    src.start()
  }

  // Continuous electrical buzz level (0..1) — driven by nearby tube flicker.
  function setBuzz(level: number) {
    if (!ctx || !buzzGain) return
    const v = Math.max(0, Math.min(1, level)) * 0.05
    buzzGain.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
  }

  // A distant, breathy shuffle/whoosh — used to punctuate an anomaly (e.g. a
  // figure glimpsed down a corridor). Deliberately faint and far-sounding.
  function phantom() {
    if (!ctx || !master) return
    const len = Math.floor(ctx.sampleRate * 1.3)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 280
    bp.Q.value = 0.9
    const g = ctx.createGain()
    g.gain.value = 0
    src.connect(bp).connect(g).connect(master)
    const now = ctx.currentTime
    g.gain.linearRampToValueAtTime(0.05, now + 0.35)
    g.gain.linearRampToValueAtTime(0, now + 1.2)
    src.start()
    src.stop(now + 1.35)
  }

  // A single soft carpet footfall placed in the stereo field. The entity fires these
  // as it moves, panned to its real bearing and louder the closer it is, so you can
  // HEAR it padding around you — and roughly where it is — even with it out of sight.
  function entityStep(pan = 0, gain = 0.25) {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    p.connect(master)
    const vol = Math.max(0, Math.min(2.8, gain))
    // Body of the footfall: a soft, dark carpet thud — lower-passed than before so it
    // reads heavy and grave rather than papery.
    const len = Math.floor(ctx.sampleRate * 0.18)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 300 + Math.random() * 120
    lp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.value = vol
    src.connect(lp).connect(g).connect(p)
    // A low sub-thump under each step gives real weight — you feel the floor take it.
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(62 + Math.random() * 14, now)
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, now)
    og.gain.exponentialRampToValueAtTime(vol * 0.9, now + 0.012)
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    osc.connect(og).connect(p)
    src.start(now)
    osc.start(now)
    osc.stop(now + 0.26)
  }

  // A faint, breathy shuffle placed in the stereo field — the creature stirring close
  // by while it stalks you unseen. Much quieter/shorter than phantom(): a "something
  // just moved to your left" tell, never a jump-scare.
  function entityBreath(pan = 0, gain = 0.06) {
    if (!ctx || !master) return
    const len = Math.floor(ctx.sampleRate * 0.9)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 480
    bp.Q.value = 0.8
    const g = ctx.createGain()
    const peak = Math.max(0, Math.min(0.4, gain))
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    src.connect(bp).connect(g).connect(p).connect(master)
    const now = ctx.currentTime
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(peak, now + 0.25)
    g.gain.linearRampToValueAtTime(0, now + 0.82)
    src.start()
    src.stop(now + 0.92)
  }

  // A short electrical arc/crackle for a tube convulsing under the entity's presence:
  // a sharp filtered-noise snap with a high zap tick, panned toward the failing light.
  // Fired on flicker "off" edges near the player so the strobing is audible, not silent.
  function flickerZap(pan = 0, gain = 0.5) {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.09)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.6
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800 + Math.random() * 1600
    bp.Q.value = 0.9
    const g = ctx.createGain()
    g.gain.value = Math.max(0, Math.min(0.9, gain))
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    src.connect(bp).connect(g).connect(p).connect(master)
    // a brief high tick on top — the snap of the arc striking
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 5200 + Math.random() * 2000
    const og = ctx.createGain()
    og.gain.setValueAtTime(Math.min(0.5, gain) * 0.5, now)
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.035)
    osc.connect(og).connect(p)
    src.start(now)
    src.stop(now + 0.1)
    osc.start(now)
    osc.stop(now + 0.04)
  }


  // they approach, the pan drifting from one side toward dead-centre (right behind
  // you), and then it stops... and laughs. The classic "don't turn around".
  function stepsBehind() {
    if (!ctx || !master) return
    const pan = ctx.createStereoPanner()
    const startSide = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.3)
    pan.pan.setValueAtTime(startSide, ctx.currentTime)
    pan.connect(master)
    const n = 9 // a quick run
    let when = ctx.currentTime + 0.05
    let gap = 0.32
    for (let s = 0; s < n; s++) {
      const prog = s / (n - 1) // 0 (far) → 1 (right behind you)
      const len = Math.floor(ctx.sampleRate * 0.12)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
      const src = ctx.createBufferSource()
      src.buffer = buf
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 320 + prog * 680 // closer = a touch brighter, but kept grave
      const g = ctx.createGain()
      g.gain.value = 0.4 + prog * 0.95 // closer = louder
      src.connect(lp).connect(g).connect(pan)
      src.start(when)
      when += gap
      gap *= 0.85 // accelerate as it bears down on you
    }
    // Pan slides from the side toward centre over the run.
    pan.pan.linearRampToValueAtTime(0.06 * Math.sign(startSide), when)
    creepyLaugh(Math.sign(startSide) * 0.12, when + 0.16)
  }

  // A distorted, breathy, descending laugh that tries to sound like a real voice
  // gone wrong: each syllable is an aspirated "h" burst + a voiced vowel shaped by
  // three vocal formants, with pitch jitter and vibrato, the whole thing pushed
  // through a waveshaper (grit) and soaked in reverb. No samples.
  function laugh(startAt: number, panPos = 0) {
    if (!ctx || !master) return
    const out = ctx.createGain()
    out.gain.value = 0.7
    const shaper = ctx.createWaveShaper()
    shaper.curve = distCurve
    shaper.oversample = '4x'
    const post = ctx.createBiquadFilter() // tame the harshest distortion highs
    post.type = 'lowpass'
    post.frequency.value = 3400
    const pan = ctx.createStereoPanner()
    pan.pan.value = panPos
    out.connect(shaper).connect(post).connect(pan).connect(master)
    if (reverbIn) post.connect(reverbIn) // wet → echoey

    // Shared vibrato LFO modulating every syllable's pitch (human wobble).
    const vib = ctx.createOscillator()
    vib.type = 'sine'
    vib.frequency.value = 6.5
    const vibGain = ctx.createGain()
    vibGain.gain.value = 7
    vib.connect(vibGain)
    vib.start(startAt)

    const syl = 6 + Math.floor(Math.random() * 4) // 6–9 "ha"s
    let t = startAt
    let pitch = 150
    for (let i = 0; i < syl; i++) {
      const prog = i / (syl - 1)
      const dur = 0.1 + Math.random() * 0.05
      const p = pitch * (0.97 + Math.random() * 0.06) // per-syllable jitter

      // Aspirated "h" onset — a short breathy noise burst before the vowel.
      const aspLen = Math.floor(ctx.sampleRate * 0.045)
      const aspBuf = ctx.createBuffer(1, aspLen, ctx.sampleRate)
      const ad = aspBuf.getChannelData(0)
      for (let k = 0; k < aspLen; k++) ad[k] = (Math.random() * 2 - 1) * (1 - k / aspLen)
      const asp = ctx.createBufferSource()
      asp.buffer = aspBuf
      const aspHp = ctx.createBiquadFilter()
      aspHp.type = 'highpass'
      aspHp.frequency.value = 1400
      const aspG = ctx.createGain()
      aspG.gain.value = 0.2
      asp.connect(aspHp).connect(aspG).connect(out)
      asp.start(t)

      // Voiced vowel: glottal sawtooth + sub, shaped by three formants.
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(p * 1.06, t + 0.02)
      o.frequency.exponentialRampToValueAtTime(p * 0.86, t + dur) // falling pitch
      vibGain.connect(o.frequency)
      const sub = ctx.createOscillator()
      sub.type = 'square'
      sub.frequency.setValueAtTime(p * 0.5, t + 0.02)

      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.linearRampToValueAtTime(1, t + 0.03)
      env.gain.exponentialRampToValueAtTime(0.0008, t + dur)

      const F = [690 + prog * 60, 1120, 2550]
      const Q = [8, 11, 13]
      const fg = [1.0, 0.6, 0.28]
      for (let k = 0; k < 3; k++) {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = F[k]
        bp.Q.value = Q[k]
        const gg = ctx.createGain()
        gg.gain.value = fg[k]
        o.connect(bp).connect(gg).connect(env)
      }
      const subG = ctx.createGain()
      subG.gain.value = 0.35
      sub.connect(subG).connect(env)
      env.connect(out)
      o.start(t)
      o.stop(t + dur + 0.03)
      sub.start(t)
      sub.stop(t + dur + 0.03)

      // Rhythm: a touch quicker in the middle of the fit, with natural variation.
      t += 0.15 - 0.04 * Math.sin(prog * Math.PI) + Math.random() * 0.04
      pitch *= 0.985 // gentle overall descent → creepier
    }
    vib.stop(t + 0.1)
  }

  // Sudden unnatural hush — everything ducks to near-silence for a moment, then the
  // room tone fades back in. The absence of the ever-present hum is deeply wrong.
  function silence(dur = 3.2) {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const cur = Math.max(0.0006, master.gain.value)
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(cur, now)
    master.gain.exponentialRampToValueAtTime(0.0006, now + 0.18)
    master.gain.setValueAtTime(0.0006, now + dur)
    master.gain.exponentialRampToValueAtTime(0.06, now + dur + 0.7)
  }

  // A violent SLAM against a wall somewhere out beyond the fog — loud and physical,
  // with a real impact crack, then bouncing all through the endless rooms (several
  // panned feedback-delay taps + heavy reverb). The world reacts too (lights/dust),
  // driven from Anomalies.tsx via worldFx.
  function distantBang() {
    if (!ctx || !master) return
    const now = ctx.currentTime

    // It's distant, but it's a hard hit — let enough midrange through to read as an
    // impact against a wall, not just a muffled thud.
    const far = ctx.createBiquadFilter()
    far.type = 'lowpass'
    far.frequency.value = 900

    const dry = ctx.createGain()
    dry.gain.value = 1.0
    far.connect(dry).connect(master)

    if (reverbIn) {
      const send = ctx.createGain()
      send.gain.value = 2.4 // soak it — make the echo clearly noticeable
      far.connect(send).connect(reverbIn)
    }

    // Several bouncing echoes through the corridors, panned around you so it clearly
    // rings out "everywhere" after the hit.
    const taps = [0.27, 0.52, 0.85]
    for (let i = 0; i < taps.length; i++) {
      const delay = ctx.createDelay(1.2)
      delay.delayTime.value = taps[i]
      const fb = ctx.createGain()
      fb.gain.value = 0.5
      const dg = ctx.createGain()
      dg.gain.value = 0.8 - i * 0.2
      const dpan = ctx.createStereoPanner()
      dpan.pan.value = (i % 2 === 0 ? 1 : -1) * (0.45 + i * 0.15)
      far.connect(delay)
      delay.connect(fb).connect(delay)
      delay.connect(dg).connect(dpan).connect(master)
    }

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.linearRampToValueAtTime(1.3, now + 0.008) // hard, loud hit
    g.gain.exponentialRampToValueAtTime(0.0008, now + 1.4)
    g.connect(far)

    // Deep sub "whoom".
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(110, now)
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.5)
    sub.connect(g)
    sub.start(now)
    sub.stop(now + 1.5)

    // Low-mid body — the weight of the slab hitting the wall.
    const body = ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(240, now)
    body.frequency.exponentialRampToValueAtTime(80, now + 0.28)
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0.7, now)
    bg.gain.exponentialRampToValueAtTime(0.0008, now + 0.4)
    body.connect(bg).connect(g)
    body.start(now)
    body.stop(now + 0.45)

    // The CRACK of the impact — a sharp brighter transient so it slams.
    const crackLen = Math.floor(ctx.sampleRate * 0.18)
    const cbuf = ctx.createBuffer(1, crackLen, ctx.sampleRate)
    const cd = cbuf.getChannelData(0)
    for (let i = 0; i < crackLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / crackLen) ** 5
    const crack = ctx.createBufferSource()
    crack.buffer = cbuf
    const cbp = ctx.createBiquadFilter()
    cbp.type = 'bandpass'
    cbp.frequency.value = 1600
    cbp.Q.value = 0.7
    const cg = ctx.createGain()
    cg.gain.value = 0.9
    crack.connect(cbp).connect(cg).connect(g)
    crack.start(now)
    crack.stop(now + 0.2)

    // Rumble tail of the impact.
    const len = Math.floor(ctx.sampleRate * 0.5)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
    const ns = ctx.createBufferSource()
    ns.buffer = buf
    ns.connect(g)
    ns.start(now)
    ns.stop(now + 0.5)
  }

  // Footsteps from a SINGLE direction that whirls around you very fast — as if one
  // thing were sprinting in a tight circle, impossibly quick. The pan spins many full
  // revolutions over the burst; deeper/graver than a normal footfall. Used by the
  // blackout "haunt" anomaly.
  function stepsAllAround(dur = 2.6) {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const pan = ctx.createStereoPanner()
    pan.connect(master)
    // Spin the pan with a fast LFO so the source appears to rotate around the player
    // several times across the burst (the stereo field sweeps left↔right rapidly).
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(3.2, now)
    lfo.frequency.linearRampToValueAtTime(6.5, now + dur) // accelerate the whirl
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.95
    lfo.connect(lfoGain).connect(pan.pan)
    lfo.start(now)
    lfo.stop(now + dur + 0.1)
    let t = now + 0.05
    const rate = 0.12
    while (t < now + dur) {
      const len = Math.floor(ctx.sampleRate * 0.13)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
      const src = ctx.createBufferSource()
      src.buffer = buf
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 280 + Math.random() * 220 // grave
      const g = ctx.createGain()
      g.gain.value = 0.55 + Math.random() * 0.3
      src.connect(lp).connect(g).connect(pan)
      src.start(t)
      t += rate * (0.9 + Math.random() * 0.2)
    }
  }

  function creepyLaugh(panPos = 0, at?: number) {
    if (!ctx || !master) return
    const now = at ?? ctx.currentTime + 0.02
    if (!laughBuffer) {
      laugh(now, panPos)
      return
    }
    const rate = 0.76 + Math.random() * 0.06 // pitch DOWN → demonic
    const shaper = ctx.createWaveShaper()
    shaper.curve = distCurve
    shaper.oversample = '4x'
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    const pan = ctx.createStereoPanner()
    pan.pan.value = panPos
    const outG = ctx.createGain()
    outG.gain.value = 0.9
    shaper.connect(lp)
    lp.connect(outG).connect(pan).connect(master)
    if (reverbIn) lp.connect(reverbIn) // echoey tail

    const src = ctx.createBufferSource()
    src.buffer = laughBuffer
    src.playbackRate.value = rate
    src.connect(shaper)
    src.start(now)

    // Sub-octave double for extra menace.
    const sub = ctx.createBufferSource()
    sub.buffer = laughBuffer
    sub.playbackRate.value = rate * 0.5
    const subG = ctx.createGain()
    subG.gain.value = 0.32
    sub.connect(subG).connect(shaper)
    sub.start(now)
  }

  // Electrical "power cut" — the lights dying: a heavy relay clunk plus the mains
  // hum de-energizing (pitch + level collapsing). Used by the haunt's blackouts.
  function powerDown() {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 1
    out.connect(master)
    if (reverbIn) out.connect(reverbIn)

    // Mains hum collapsing.
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(120, now)
    o.frequency.exponentialRampToValueAtTime(30, now + 0.26)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1100
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.4, now)
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.3)
    o.connect(lp).connect(og).connect(out)
    o.start(now)
    o.stop(now + 0.32)

    // Relay clunk.
    const len = Math.floor(ctx.sampleRate * 0.06)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
    const cl = ctx.createBufferSource()
    cl.buffer = buf
    const clp = ctx.createBiquadFilter()
    clp.type = 'lowpass'
    clp.frequency.value = 700
    const cg = ctx.createGain()
    cg.gain.value = 0.5
    cl.connect(clp).connect(cg).connect(out)
    cl.start(now)
  }

  // Electrical "power on" — fluorescent tubes striking: a couple of quick ignition
  // ticks then the mains hum buzzing up to pitch. Used by the haunt's flashes.
  function powerUp() {
    if (!ctx || !master) return
    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 1
    out.connect(master)

    // Ignition ticks (the starter trying to strike the tube).
    for (let k = 0; k < 2; k++) {
      const when = now + k * 0.045
      const len = Math.floor(ctx.sampleRate * 0.025)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
      const tick = ctx.createBufferSource()
      tick.buffer = buf
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2600
      const g = ctx.createGain()
      g.gain.value = 0.4
      tick.connect(hp).connect(g).connect(out)
      tick.start(when)
    }

    // Hum buzzing up to mains pitch as the tube catches.
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(50, now + 0.04)
    o.frequency.exponentialRampToValueAtTime(120, now + 0.16)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 700
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0008, now + 0.04)
    og.gain.linearRampToValueAtTime(0.34, now + 0.1)
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.4)
    o.connect(hp).connect(og).connect(out)
    o.start(now + 0.04)
    o.stop(now + 0.42)
  }

  // The camera/tape dying when the entity catches you: the hum is killed instantly
  // and replaced by a burst of harsh static that decays — the found-footage cut.
  // Returns nothing; pair with signalReboot() when the camera powers back on.
  function signalLost() {
    if (!ctx || !master) return
    const now = ctx.currentTime
    // Kill the ambient bed hard.
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(Math.max(0.0006, master.gain.value), now)
    master.gain.exponentialRampToValueAtTime(0.0006, now + 0.08)

    // Static burst on its own path (so it isn't ducked by the master kill).
    const burst = ctx.createGain()
    burst.gain.setValueAtTime(0.0001, now)
    burst.gain.exponentialRampToValueAtTime(0.5, now + 0.02)
    burst.gain.exponentialRampToValueAtTime(0.06, now + 1.6)
    burst.gain.exponentialRampToValueAtTime(0.0006, now + 2.4)
    burst.connect(ctx.destination)
    const len = Math.floor(ctx.sampleRate * 2.6)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const ns = ctx.createBufferSource()
    ns.buffer = buf
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200
    ns.connect(hp).connect(burst)
    ns.start(now)
    ns.stop(now + 2.6)
  }

  // Camera powering back up after a respawn: restore the ambient bed + a tube strike.
  function signalReboot() {
    if (!ctx || !master) return
    const now = ctx.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(Math.max(0.0006, master.gain.value), now)
    master.gain.exponentialRampToValueAtTime(0.06, now + 0.9)
    powerUp()
  }

  // Continuous "presence" dread drone (0..1), driven every frame by how close the
  // entity is. A body-felt sub rumble + a faint breath that swells as it nears —
  // the audible half of the proximity interference. Built lazily on first use; an
  // inner LFO makes it breathe, the outer gain (set here) tracks proximity so it is
  // truly silent when the thing is far away.
  let presenceGain: GainNode | null = null
  function setPresence(level: number) {
    if (!ctx) return
    const lv = Math.max(0, Math.min(1, level))
    if (!presenceGain) {
      presenceGain = ctx.createGain()
      presenceGain.gain.value = 0.0001
      const inner = ctx.createGain()
      inner.gain.value = 1
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 210
      lp.Q.value = 0.7
      inner.connect(presenceGain).connect(lp).connect(ctx.destination)
      for (const f of [41.5, 62.4]) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f
        o.connect(inner)
        o.start()
      }
      const len = Math.floor(ctx.sampleRate * 2)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      const ns = ctx.createBufferSource()
      ns.buffer = buf
      ns.loop = true
      const nf = ctx.createBiquadFilter()
      nf.type = 'bandpass'
      nf.frequency.value = 150
      nf.Q.value = 0.9
      const ng = ctx.createGain()
      ng.gain.value = 0.3
      ns.connect(nf).connect(ng).connect(inner)
      ns.start()
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = 0.28
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.3
      lfo.connect(lfoGain).connect(inner.gain)
      lfo.start()
    }
    presenceGain.gain.setTargetAtTime(0.0001 + lv * 0.085, ctx.currentTime, 0.15)
  }

  // The camcorder hits the floor: a low body thump + a short carpet/plastic impact.
  // Routed straight to the destination so the master kill (signalLost) can't duck it.
  function cameraDrop() {
    if (!ctx) return
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(92, now)
    o.frequency.exponentialRampToValueAtTime(38, now + 0.18)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, now)
    og.gain.exponentialRampToValueAtTime(0.9, now + 0.012)
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.4)
    o.connect(og).connect(ctx.destination)
    o.start(now)
    o.stop(now + 0.45)
    const len = Math.floor(ctx.sampleRate * 0.25)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
    const ns = ctx.createBufferSource()
    ns.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 900
    lp.Q.value = 0.6
    const ng = ctx.createGain()
    ng.gain.value = 0.5
    ns.connect(lp).connect(ng).connect(ctx.destination)
    ns.start(now)
  }

  // The moment it commits to the kill: a fast rising whoosh + a brief distorted
  // screech. Aggressive but short — the lunge out of curiosity into attack.
  function lunge() {
    if (!ctx) return
    const now = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.6)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const ns = ctx.createBufferSource()
    ns.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.2
    bp.frequency.setValueAtTime(300, now)
    bp.frequency.exponentialRampToValueAtTime(2600, now + 0.32)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.18)
    g.gain.exponentialRampToValueAtTime(0.0006, now + 0.6)
    ns.connect(bp).connect(g).connect(ctx.destination)
    ns.start(now)
    ns.stop(now + 0.6)
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(220, now)
    o.frequency.exponentialRampToValueAtTime(70, now + 0.4)
    const ws = ctx.createWaveShaper()
    ws.curve = distCurve
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, now)
    og.gain.exponentialRampToValueAtTime(0.16, now + 0.05)
    og.gain.exponentialRampToValueAtTime(0.0006, now + 0.5)
    o.connect(ws).connect(og).connect(ctx.destination)
    o.start(now)
    o.stop(now + 0.55)
  }

  // The instant it seizes you: a loud, terrifying stinger to slam under the forced
  // look at the entity — a body-hit sub, a distorted roar (detuned saws through the
  // waveshaper) and a metallic screech rising over the top. Routed straight to the
  // destination so nothing ducks it.
  function caught() {
    if (!ctx) return
    const now = ctx.currentTime
    // Sub impact — the grab lands.
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(140, now)
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.5)
    const subG = ctx.createGain()
    subG.gain.setValueAtTime(0.0001, now)
    subG.gain.exponentialRampToValueAtTime(0.95, now + 0.02)
    subG.gain.exponentialRampToValueAtTime(0.0008, now + 0.9)
    sub.connect(subG).connect(ctx.destination)
    sub.start(now)
    sub.stop(now + 0.95)
    // Distorted roar — a cluster of detuned saws shoved through the soft-clip curve,
    // with the lowpass opening up so it snarls.
    const ws = ctx.createWaveShaper()
    ws.curve = distCurve
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(320, now)
    lp.frequency.exponentialRampToValueAtTime(2200, now + 0.35)
    lp.Q.value = 1.1
    const roarG = ctx.createGain()
    roarG.gain.setValueAtTime(0.0001, now)
    roarG.gain.exponentialRampToValueAtTime(0.5, now + 0.06)
    roarG.gain.exponentialRampToValueAtTime(0.18, now + 0.5)
    roarG.gain.exponentialRampToValueAtTime(0.0006, now + 1.2)
    ws.connect(lp).connect(roarG).connect(ctx.destination)
    for (const f of [70, 96, 138]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f, now)
      o.frequency.exponentialRampToValueAtTime(f * 0.6, now + 1.0)
      o.connect(ws)
      o.start(now)
      o.stop(now + 1.2)
    }
    // Metallic screech — bandpass noise sweeping up, the "wrong" voice over the roar.
    const len = Math.floor(ctx.sampleRate * 1.0)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const ns = ctx.createBufferSource()
    ns.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 4
    bp.frequency.setValueAtTime(900, now)
    bp.frequency.exponentialRampToValueAtTime(3800, now + 0.45)
    const scrG = ctx.createGain()
    scrG.gain.setValueAtTime(0.0001, now)
    scrG.gain.exponentialRampToValueAtTime(0.3, now + 0.12)
    scrG.gain.exponentialRampToValueAtTime(0.0006, now + 0.9)
    ns.connect(bp).connect(scrG).connect(ctx.destination)
    ns.start(now)
    ns.stop(now + 1.0)
  }

  return { start, footstep, setBuzz, phantom, stepsBehind, stepsAllAround, silence, distantBang, creepyLaugh, powerDown, powerUp, signalLost, signalReboot, setPresence, cameraDrop, lunge, caught, entityStep, entityBreath, flickerZap }
}

export type Hum = ReturnType<typeof createHum>
