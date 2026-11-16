# Ta La Lab

**A carnatic metronome with the real thing: all 35 talas, built from their angas.**

Most metronomes count clicks. This one knows the tala: every cycle is built from its
angas — the laghu (a clap followed by finger counts), the drutham (a wave, 2 aksharas)
and the anudhrutham (a tap) — with a tanpura-style Sa-Pa drone synthesized live.
No samples, no libraries, no backend.

## What it does
- **All 35 talas** — 7 families (Dhruva, Mathya, Rupaka, Jhampa, Triputa, Ata, Eka)
  × 5 jaathis (Tisra 3, Chaturashra 4, Khanda 5, Misra 7, Sankeerna 9)
- **Anga visualization** — clap + finger-count blocks for the laghu, wave blocks for the
  drutham, each akshara lighting up in sequence
- **Tanpura drone** — a synthesized Sa-Pa drone (two detuned oscillator pairs), pick your
  adharashadja from the dropdown
- **Gati subdivisions** — 1, 2 or 4 swaras per akshara
- **Tempo** 40–240 bpm, spacebar start/stop, volume control

## The default tala
**Adi** = Chaturashra jaathi Triputa: laghu(4) + drutham(2) + drutham(2) = 8 aksharas —
the 4+2+2 cycle most krithis are set to.

## Files
| File | What it is |
|---|---|
| `src/talas.js` | the 7 families, 5 jaathis, akshara expansion |
| `src/main.js` | Web Audio scheduler (lookahead pattern), synthesized taps, drone, visualization |

## Run / build / deploy
```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # → dist/
```
GitHub Actions deploys to Cloudflare Pages on every push to `main`.
Live: **https://tala.krithiuk.space**
