# Optional drop-in assets

The game works fully without any of these files — it falls back to procedurally
generated audio/visuals. Drop a file in to override the procedural version.

## Creepy laugh  →  `public/audio/laugh.mp3` (or `.ogg` / `.wav`)
Used by the "steps behind" (key 4) and "haunt" (key 7) anomalies. Whatever you
provide is automatically pitched down, distorted and drenched in reverb, so even a
normal/ordinary laugh comes out sinister. A short clip (1–3 s) works best.

You can record your own, or download a **CC0 / public-domain** clip from:
- Pixabay sound effects (free, no attribution): https://pixabay.com/sound-effects/search/evil%20laugh/
- Freesound, filtered to license = "Creative Commons 0":
  https://freesound.org/search/?q=evil+laugh&f=license:%22Creative+Commons+0%22
- OpenGameArt, license filter = CC0: https://opengameart.org/

Always confirm the file's page says **CC0 / Public Domain** (or Pixabay license)
before using it, especially if this project ever ships.

## Figure image  →  `public/figure.png`
A transparent-background PNG, portrait orientation (~1:2, e.g. 128×256). It's
rendered as a dark silhouette, so the alpha/shape is what matters. Used by the
figure (key 1) and haunt (key 7) anomalies. Without it, a procedural silhouette is
drawn instead.

CC0 silhouette/figure sources:
- OpenGameArt (CC0 filter), search "silhouette" / "shadow" / "creature"
- itch.io free CC0 game assets: https://itch.io/game-assets/assets-cc0/free/tag-horror
