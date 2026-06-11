import * as THREE from 'three'
import { Effect } from 'postprocessing'
import { wrapEffect } from '@react-three/postprocessing'

// Whether the experience has actually been entered (pointer locked). Until the
// player presses "Entrar" the menu shows a still, dormant scene: the entity never
// spawns, anomalies never fire, and the camera holds static. Pausing (Esc) flips
// this back off, freezing the hunt.
export const gameState = { playing: false }

// Shared camera angular velocity, written by the player rig and read by the VHS
// effect to drive a subtle motion blur.
export const cameraMotion = { x: 0, y: 0 }

// Hunt panic (0..1): spikes the instant the entity commits to a chase and holds
// while it pursues, then decays. The Player rig reads it for a panicked camera
// (shake + a slight FOV punch) and the VHS pass for an adrenaline vignette.
export const huntFx = { level: 0 }

// Autofocus-hunt blur amount (0..1) + current camera exposure, written by the
// player rig. exposure drives the reactive iris/vignette in the VHS pass.
export const cameraFx = { focus: 0, exposure: 1 }

// HUD signals shared with the camera overlay.
export const hudState = { lowLight: false }

// Current fluorescent light level (0..~1), written by the Lighting rig and read
// by the player (auto-gain / LOW LIGHT) so the camera reacts to real light
// changes — flicker and brown-outs — rather than to head pitch.
export const lightFx = { level: 1 }

// Tube-blackout anomaly coordination. The anomaly director (Anomalies.tsx) picks a
// ceiling-grid tube and drives `level` 1→0→1; Fixtures.tsx multiplies that tube's
// brightness by it so a specific fluorescent dies and later comes back.
export const anomalyState = { boI: 0, boJ: 0, boLevel: 1, boActive: false }

// Distant-bang shockwave + scripted blackouts. The bang anomaly sets the shock:
// `quake` (1→0) is the decaying energy, `flick` (0..1) the per-frame light level it
// drives (every fluorescent AND the room fill dip together), and each bump of
// `bangSeq` triggers a one-shot ceiling-dust burst (Dust.tsx watches the counter).
// `lights` (0..1) is a master light master used by the "haunt" anomaly to black the
// whole level out and snap it back on. Read by Fixtures, Lighting and Player.
export const worldFx = { quake: 0, flick: 1, bangSeq: 0, lights: 1 }

// --- Phase 4: the entity hunt ---------------------------------------------------
// Live player state, written every frame by the Player rig and read by the Entity
// for perception (sight/hearing) and by the death director for the catch test.
export const playerState = { x: 0, z: 0, moving: false, sprint: false, creep: false, noise: 0, alive: true }

// Player control channel written by the death director and read by the Player rig.
// `frozen` halts input during the signal-loss sequence; bumping `respawnSeq` (with
// new coords) teleports the player on the next frame (the found-footage "cut").
export const playerControl = { frozen: false, respawnSeq: 0, x: 0, z: 0 }

// Touch input channel (mobile). The on-screen controls write here and the Player
// rig reads it each frame. `mvX/mvY` are the analog joystick axes (mvY +1 = forward,
// mvX +1 = strafe right); `lookDX/lookDY` are accumulated look-drag deltas in pixels
// (consumed and zeroed each frame); `sprint/creep` are the held movement-mode buttons.
export const touchInput = { active: false, mvX: 0, mvY: 0, lookDX: 0, lookDY: 0, sprint: false, creep: false }

// Live entity state, written by the Entity and read by the HUD/audio for proximity
// cues. `mode` is its current FSM state; `dist` is metres to the player.
export const entityState = {
  x: 0,
  z: 0,
  active: false,
  dist: 999,
  aura: 0,
  mode: 'wander' as 'wander' | 'investigate' | 'chase' | 'search',
}

// Found-footage signal state. `phase` drives both the VHS pass (glitch/noise burst)
// and the HUD ("NO SIGNAL"). 'lost' = just caught (tape tearing out), 'reboot' =
// camera powering back up after respawn, 'live' = normal. `level` (0..1) is the
// glitch intensity ramp consumed by the VHS shader.
export const signalFx = { phase: 'live' as 'live' | 'lost' | 'reboot', level: 0 }

// Entity proximity interference (0..1). The Entity writes this from how close it is
// (and whether it has line of sight); the VHS pass reads it to bleed chroma, jitter
// the tracking and pulse the image darker — a found-footage "presence" that frays
// the signal and telegraphs the thing before you turn around. Deliberately subtle
// (EMI-like, not full snow — the snow is reserved for the death cut below).
export const proximityFx = { level: 0 }

// Death camera. When the entity catches you the camcorder is dropped. The death
// plays in three beats coordinated between the Entity (which drives `phase` and the
// timing) and the Player rig (which renders the camera): 'grab' — the rig snaps to
// frame the entity as it seizes you (a forced, shaking look) — then 'fall' — the
// camera tumbles to the floor over DEATH_FALL seconds, tipping onto `dir` (±1) —
// then 'down' — it lies on the carpet until the signal gives out. `ex/ez/ey` are the
// entity's head position the rig aims at during the grab.
export const deathCam = {
  active: false,
  phase: 'none' as 'none' | 'grab' | 'fall' | 'down',
  dir: 1,
  ex: 0,
  ez: 0,
  ey: 1.7,
}
export const DEATH_FALL = 0.85

// ---------------------------------------------------------------------------
// Custom full-frame fisheye (no black border): corners map to themselves while
// the centre is magnified, giving a gentle lens bulge.
// ---------------------------------------------------------------------------
const fisheyeFrag = /* glsl */ `
uniform float strength;

void mainUv(inout vec2 uv) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float f = (1.0 - strength) + strength * (r2 / 0.5);
  uv = 0.5 + c * f;
}
`

class FisheyeEffect extends Effect {
  constructor({ strength = 0.12 }: { strength?: number } = {}) {
    super('FisheyeEffect', fisheyeFrag, {
      uniforms: new Map([['strength', new THREE.Uniform(strength)]]),
    })
  }
}

// ---------------------------------------------------------------------------
// Custom VHS: motion blur (turn direction), wobble, chroma bleed, light-reactive
// ISO grain, rare dropout lines, lens dirt that catches the lights, scanline.
// ---------------------------------------------------------------------------
const vhsFrag = /* glsl */ `
uniform float time;
uniform float wobble;
uniform float chroma;
uniform float noiseAmount;
uniform vec2 camVel;
uniform float focus;
uniform float exposure;
uniform float glitch;
uniform float interference;
uniform float hunt;

float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float blob(vec2 uv, vec2 c, float r) { return smoothstep(r, 0.0, length(uv - c)); }

// A few fixed soft smudges to mimic a dirty lens.
float smudge(vec2 uv) {
  float s = 0.0;
  s += blob(uv, vec2(0.30, 0.70), 0.20) * 0.6;
  s += blob(uv, vec2(0.72, 0.40), 0.13) * 0.5;
  s += blob(uv, vec2(0.52, 0.55), 0.28) * 0.25;
  s += blob(uv, vec2(0.15, 0.30), 0.10) * 0.4;
  return s;
}

void mainUv(inout vec2 uv) {
  float w = sin(uv.y * 130.0 + time * 6.0) * 0.0006
          + sin(uv.y * 11.0 - time * 1.4) * 0.0016;
  uv.x += w * wobble;

  // VHS head-switching: a torn, jittering band at the very bottom of the frame.
  float tear = 1.0 - smoothstep(0.0, 0.045, uv.y);
  uv.x += tear * (sin(time * 30.0) * 0.012
        + (rand(vec2(floor(uv.y * 220.0), floor(time * 45.0))) - 0.5) * 0.05);

  // Signal loss: the picture tears apart — big horizontal rip bands jump sideways
  // and the frame rolls vertically, like a tape losing tracking as it's yanked out.
  if (glitch > 0.001) {
    float band = floor(uv.y * 14.0 + time * 2.0);
    float j = (rand(vec2(band, floor(time * 24.0))) - 0.5);
    uv.x += j * glitch * 0.6;
    float roll = fract(time * 1.7);
    uv.y = fract(uv.y + roll * glitch);
  }

  // Entity proximity: the signal frays as the presence closes in — a fine
  // per-scanline horizontal jitter plus the odd tracking-slip band drifting down.
  if (interference > 0.001) {
    uv.x += (rand(vec2(floor(uv.y * 90.0), floor(time * 30.0))) - 0.5) * 0.011 * interference;
    float slip = step(0.9, rand(vec2(floor(uv.y * 16.0 - time * 3.0), floor(time * 5.0))));
    uv.x += slip * (rand(vec2(floor(time * 5.0), 7.0)) - 0.5) * 0.045 * interference;
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Subtle camera motion blur along the turn direction (skipped when still).
  vec2 mb = clamp(camVel * 0.9, vec2(-0.035), vec2(0.035));
  vec3 col = inputColor.rgb;
  if (dot(mb, mb) > 1e-7) {
    col = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float k = float(i) / 4.0 - 0.5;
      col += texture(inputBuffer, uv + mb * k).rgb;
    }
    col /= 5.0;
  }

  // Lens softness (stronger at the edges) + an occasional autofocus hunt.
  vec2 cc = uv - 0.5;
  float blurAmt = (dot(cc, cc) * 0.6 + focus) * 0.004;
  if (blurAmt > 0.0002) {
    vec3 acc = col;
    acc += texture(inputBuffer, uv + vec2(blurAmt, 0.0)).rgb;
    acc += texture(inputBuffer, uv - vec2(blurAmt, 0.0)).rgb;
    acc += texture(inputBuffer, uv + vec2(0.0, blurAmt)).rgb;
    acc += texture(inputBuffer, uv - vec2(0.0, blurAmt)).rgb;
    col = acc / 5.0;
  }

  // Lens basis, reused by the exposure iris below. (The old chromatic-aberration
  // channel split was removed: on the thin bright tubes it pulled red/blue off the
  // bar and left pure green, which read as an ugly green streak when looking at a
  // light.)
  vec2 dir = uv - 0.5;
  float edge = dot(dir, dir);

  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // ISO-style grain: stronger in shadows, fades out in the light.
  float n = rand(vec2(uv.y * 200.0, time));
  float iso = noiseAmount * mix(1.3, 0.3, clamp(lum, 0.0, 1.0));
  col += (n - 0.5) * iso;

  // (dropout line removed — it caused an intermittent green-ish flash)

  // Lens dirt that only lights up under the bright fluorescents.
  float glow = smoothstep(0.45, 1.0, lum);
  col += smudge(uv) * glow * 0.18;

  // Warm halation: a soft warm glow blooming off the bright fluorescents.
  vec3 halo = texture(inputBuffer, uv + vec2( 0.007,  0.007)).rgb
            + texture(inputBuffer, uv + vec2(-0.007,  0.007)).rgb
            + texture(inputBuffer, uv + vec2( 0.007, -0.007)).rgb
            + texture(inputBuffer, uv + vec2(-0.007, -0.007)).rgb;
  halo *= 0.25;
  float hglow = smoothstep(0.4, 0.9, dot(halo, vec3(0.299, 0.587, 0.114)));
  col += hglow * vec3(1.0, 0.72, 0.40) * 0.16;

  // Rolling fluorescent flicker: a faint bright band drifting down the frame,
  // like a camcorder shutter beating against mains-powered lights.
  col *= 1.0 + sin(uv.y * 6.2831 * 1.5 - time * 1.6) * 0.012;

  // Exposure-reactive iris: the edges fall off a little more when the camera
  // stops down on the bright ceiling lights.
  float iris = clamp((1.06 - exposure) / 0.28, 0.0, 1.0);
  col *= 1.0 - edge * iris * 0.22;

  // Hunt panic: a tunnel-vision vignette closes in and a fast pulse runs through it
  // the instant it starts chasing — adrenaline, found-footage style.
  if (hunt > 0.001) {
    float pulse = 0.85 + 0.15 * sin(time * 9.0);
    col *= 1.0 - edge * hunt * 1.5 * pulse;
    col += (rand(vec2(uv.x * 220.0 + time * 60.0, uv.y * 180.0)) - 0.5) * 0.05 * hunt;
  }

  // Head-switching static in the bottom band.
  float band = 1.0 - smoothstep(0.0, 0.05, uv.y);
  if (band > 0.001) {
    float ns = rand(vec2(uv.x * 130.0, floor(time * 45.0)));
    col = mix(col, vec3(ns) * 0.5 + col * 0.5, band * 0.5);
  }

  // Very subtle scanline + faint interlacing (alternating fields).
  col *= 0.985 + 0.015 * sin(uv.y * 900.0);
  col *= 1.0 - mod(floor(uv.y * 240.0) + floor(time * 50.0), 2.0) * 0.010;

  // Entity proximity: a chroma bleed, extra shadow grain and a slow dark pulse, as
  // if a presence were pressing on the signal. Kept EMI-subtle (not static — that's
  // the death cut below) so it unsettles and telegraphs without breaking immersion.
  if (interference > 0.001) {
    float fi = interference;
    float off = 0.0042 * fi;
    float cr = texture(inputBuffer, uv + vec2(off, 0.0)).r;
    float cb = texture(inputBuffer, uv - vec2(off, 0.0)).b;
    col.r = mix(col.r, cr, 0.8);
    col.b = mix(col.b, cb, 0.8);
    float gn = rand(vec2(uv.x * 320.0 - time * 40.0, uv.y * 240.0 + time * 20.0));
    col += (gn - 0.5) * 0.09 * fi;
    float pulse = 0.5 + 0.5 * sin(time * 4.5);
    col *= 1.0 - fi * (0.09 + 0.06 * pulse);
    float grey2 = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(grey2), fi * 0.18);
  }

  // Signal loss: drown the picture in TV snow, desaturate and crush it toward black
  // as the "tape" gives out — the found-footage cut when the entity catches you.
  if (glitch > 0.001) {
    float snow = rand(vec2(uv.x * 640.0 + time * 53.0, uv.y * 480.0 - time * 37.0));
    float g = clamp(glitch, 0.0, 1.0);
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(grey), g * 0.8);          // desaturate
    col = mix(col, vec3(snow), g * 0.85);          // TV static
    col *= 1.0 - g * 0.35;                          // dim toward black
    float scan = 0.5 + 0.5 * sin(uv.y * 240.0 - time * 30.0);
    col *= 1.0 - g * 0.25 * scan;                   // harsh rolling scanlines
  }

  outputColor = vec4(col, inputColor.a);
}
`

class VHSEffect extends Effect {
  constructor({ wobble = 0.3, chroma = 0.0009, noiseAmount = 0.03 }: {
    wobble?: number
    chroma?: number
    noiseAmount?: number
  } = {}) {
    super('VHSEffect', vhsFrag, {
      uniforms: new Map<string, THREE.Uniform>([
        ['time', new THREE.Uniform(0)],
        ['wobble', new THREE.Uniform(wobble)],
        ['chroma', new THREE.Uniform(chroma)],
        ['noiseAmount', new THREE.Uniform(noiseAmount)],
        ['camVel', new THREE.Uniform(new THREE.Vector2())],
        ['focus', new THREE.Uniform(0)],
        ['exposure', new THREE.Uniform(1)],
        ['glitch', new THREE.Uniform(0)],
        ['interference', new THREE.Uniform(0)],
        ['hunt', new THREE.Uniform(0)],
      ]),
    })
  }

  update(_renderer: THREE.WebGLRenderer, _inputBuffer: THREE.WebGLRenderTarget, deltaTime = 0) {
    const t = this.uniforms.get('time')
    if (t) t.value += deltaTime
    const v = this.uniforms.get('camVel')
    if (v) (v.value as THREE.Vector2).set(cameraMotion.x, cameraMotion.y)
    const f = this.uniforms.get('focus')
    if (f) f.value = cameraFx.focus
    const ex = this.uniforms.get('exposure')
    if (ex) ex.value = cameraFx.exposure
    const gl = this.uniforms.get('glitch')
    if (gl) gl.value = signalFx.level
    const itf = this.uniforms.get('interference')
    if (itf) itf.value = proximityFx.level
    const ht = this.uniforms.get('hunt')
    if (ht) ht.value = huntFx.level
  }
}

const anamorphicFrag = /* glsl */ `
uniform float strength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Accumulate only the BRIGHTNESS of nearby pixels horizontally, then tint with a
  // fixed warm colour. Driving the streak from a scalar (not the raw sampled RGB)
  // keeps it reliably warm and avoids the green fringing on the bright tubes.
  float streak = 0.0;
  float total = 0.0;
  for (int i = -10; i <= 10; i++) {
    float fi = float(i);
    float w = 1.0 - abs(fi) / 11.0;
    vec3 s = texture(inputBuffer, uv + vec2(fi * 0.009, 0.0)).rgb;
    streak += smoothstep(0.45, 0.9, dot(s, vec3(0.299, 0.587, 0.114))) * w;
    total += w;
  }
  streak /= total;
  outputColor = vec4(inputColor.rgb + streak * strength * vec3(1.0, 0.82, 0.5), inputColor.a);
}
`

class AnamorphicEffect extends Effect {
  constructor({ strength = 2.0 }: { strength?: number } = {}) {
    super('AnamorphicEffect', anamorphicFrag, {
      uniforms: new Map([['strength', new THREE.Uniform(strength)]]),
    })
  }
}

export const Fisheye = wrapEffect(FisheyeEffect)
export const VHS = wrapEffect(VHSEffect)
export const Anamorphic = wrapEffect(AnamorphicEffect)
