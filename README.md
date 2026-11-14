# E-Studio

A recording studio for iPhone, built as a web app you add to the home screen. It runs full screen,
works offline, and keeps every song on the phone (IndexedDB). No build step and no dependencies:
plain HTML, CSS and JavaScript modules.

## What it does

| Tab | What's there |
|---|---|
| **Studio** | Multitrack recorder: record from the mic or the Keys with a count-in, then mute, solo, set volume and pan. Import audio (WAV, MP3, M4A), nudge takes, export the mix as WAV |
| **Song** | Song generator: pick a style (Trap, Drill, Boom bap, R&B, Screw, Pop), a mood (Dark, Sad, Chill, Happy), a key and a length (8-bar loop, ~40-bar song, ~68-bar full song). It writes the chords, the 808 or bass line, a hook melody and the drum groove, laid out as intro, verses, hooks and outro. Each section shows its chords and has a lyric pad with a writing prompt; tap a section to play from it. Roll the melody, chords or drums again on their own. Parts land as tracks in Studio (badge SONG), the groove lands on the Beat tab, and Auto-Tune is set to the song's key |
| **Beat** | 16-step drum machine (kick, 808, snare, clap, hats, rim), all synthesized. Presets for trap, boom bap and screw, plus swing and 808 tuning |
| **Keys** | Two-octave touch keyboard with Keys, Lead, Square, Bass and Pad sounds. Records straight to a track |
| **Auto-Tune** | Pitch correction snapped to a key and scale. Speed 0 gives the hard robotic sound; slower speeds sound natural. Detects the key from the vocal and draws your pitch against the tuned pitch |
| **Screw** | Chopped & Screwed: slows the mix or any track down so the pitch drops, then adds beat-synced chops (repeat, stutter, backspin, mix), a dark echo and a muffle. Live pads (CHOP, DOUBLE, SPIN, BRAKE) chop it as it plays, and **Record my chops** saves the run as a track |

How it works: the song generator (`js/music/songgen.js`) is seeded, so each roll is repeatable;
its parts are synthesized in plain JavaScript (`js/audio/render.js`), a 2–3 minute song in a couple
of seconds. Auto-Tune finds the pitch with YIN and re-pitches with TD-PSOLA (`js/dsp/autotune.js`).
The screw is a tape-style resample plus bar-grid chops (`js/dsp/screw.js`). Both run in a worker.

## Getting it on an iPhone

The microphone only works over **HTTPS**, so the folder has to be hosted. Any static host works,
for example GitHub Pages, Netlify or Cloudflare Pages. Then:

1. Open the URL in Safari on the iPhone.
2. Tap Share, then **Add to Home Screen**.
3. Open E-Studio from the home screen and allow the microphone the first time you record.

Use wired headphones when you record. If takes land late (Bluetooth adds about 200 ms), go to
Menu, then **Recording timing**, and raise the shift.

## Running it on this PC

```
python -m http.server 8791 --directory "C:\E-Estimating\e-estimatingllc ai creations\E-Studio"
```

Then open http://localhost:8791. Localhost counts as secure, so the mic works there too. The
offline cache (`sw.js`) is off on localhost. Bump `VERSION` in `sw.js` whenever files change,
so installed copies update.

Built for E-Estimating LLC; the app icon is the official logo (`brand/e-estimating-logo.svg`).
