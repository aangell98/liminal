import { EffectComposer, Vignette } from '@react-three/postprocessing'
import { Fisheye, VHS } from './retro'

// Found-footage pipeline. Light glow comes from real billboarded halos on the
// fixtures (stable under motion), so no bloom/anamorphic here — those sampled the
// tiny bright tubes in screen space and shimmered as the view moved.
export function Effects() {
  return (
    <EffectComposer>
      <Fisheye strength={0.32} />
      <VHS wobble={0.45} chroma={0.0012} noiseAmount={0.03} />
      <Vignette offset={0.5} darkness={0.28} />
    </EffectComposer>
  )
}
