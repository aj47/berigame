# BeriGame original trailer soundtrack

**Small Friends, Great Big World** — a 40.000-second instrumental cue composed for the BeriGame cinematic trailer. D major, a 120 BPM underlying pulse, warm orchestral colors, playful phrasing, and a fully resolved ending. No dialogue or narration.

## Deliverables

- `berigame-trailer-mix.wav`: mastered stereo mix, 48 kHz / 24-bit PCM, exactly 1,920,000 frames.
- `berigame-trailer-music.wav`: music at the same level and offset as the master.
- `berigame-trailer-sfx.wav`: sound design at the same level and offset as the master.
- `berigame-trailer-preview.mp3`: convenient 256 kbps listening copy. Use WAV for the edit.
- `instrument-stems/`: thirteen dry orchestral parts before balancing and mastering.
- `score.json`: original note, controller, timing, orchestration, and mix data.
- `audio-waveform-qa.png`, `qa.json`: verification evidence.

The music and SFX stems are additive: summing them at unity recreates the master to 24-bit rounding precision. All begin at trailer time zero. There is no lead-in or preroll.

## Cue map

| Time | Music and sound design |
|---|---|
| 0–4 s | Close, intimate celesta and harp over a soft suspended string bed; seed sparkle, faint forest breeze, birds. |
| 4–8 s | A blooming island reveal with flute, strings, warm brass, and a soft reveal breath. |
| 8–13 s | Skipping pizzicato, light percussion, an original flute adventure theme, and tiny earthy footsteps. |
| 13–17 s | Bassoon and pizzicato comedy; two delicate fox sniffs and a soft curious nose sound. |
| 17–22 s | A gentle, resonant Giant entrance; low strings, restrained timpani, horn ascent, and soft stone texture. |
| 22–27 s | Full theme, brass and flute in octaves, rhythmic strings, warm percussion, teamwork swells. |
| 27–33 s | Warm, spacious strings and flute; harp figures, light ceramic cup sounds, distant birds. |
| 33–40 s | A IV–V–I logo resolution, held strings and horns, harp ascent, bell halo; smooth final fade to digital silence. |

## Verified output

- Integrated loudness: **−16.04 LUFS** (FFmpeg BS.1770 `loudnorm` analysis).
- True peak: **−1.24 dBTP**.
- Loudness range: **10.2 LU**.
- Clipped samples: **0**.
- Last sample: **digital silence**.
- All samples finite; stereo correlation **0.883**.
- Duration and format checked from the actual WAV, not inferred from the score.
- Waveform inspected across all sections. These are technical checks; final subjective listening against picture remains an editorial review.

## Reproduce

From this directory on macOS, with Swift/AVFoundation, Python (`numpy`, `scipy`, `soundfile`, `matplotlib`) and FFmpeg already available:

```sh
python3 compose.py
swift render_score.swift score.json
python3 mix.py
python3 verify_audio.py
ffmpeg -hide_banner -loglevel error -y -i berigame-trailer-mix.wav -c:a libmp3lame -b:a 256k berigame-trailer-preview.mp3
```

`compose.py` authors the original score. `render_score.swift` performs sample-accurate offline MIDI rendering through AVAudioUnitSampler using macOS's installed `gs_instruments.dls`. `mix.py` balances, pans, reverberates, and masters the parts, and synthesizes every sound-design element. Seeds make procedural elements reproducible. No music, meme audio, or external recordings were downloaded.

The built-in General MIDI instruments are deliberately orchestrated and softened, but they are sampled orchestral synthesis rather than a live orchestra or a premium cinematic sample library. Reproduction of those orchestral timbres requires macOS with the system DLS bank present. The provided WAVs are portable.
