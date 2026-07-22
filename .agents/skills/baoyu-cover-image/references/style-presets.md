# Style Presets

`--style X` expands to a palette + rendering combination. Users can override either dimension. The catalog keeps all six cover dimensions intact and currently exposes 10 palettes and 8 renderings.

| --style | Palette | Rendering |
|---------|---------|-----------|
| `elegant` | `elegant` | `hand-drawn` |
| `blueprint` | `cool` | `digital` |
| `binance` | `binance` | `isometric` |
| `binance-master` | `binance` | `isometric` |
| `binance-briefing` | `binance` | `isometric` |
| `binance-mondo-panoramic` | `binance` | `screen-print` |
| `binance-sketch-notes` | `binance` | `hand-drawn` |
| `binance-vector-illustration` | `binance` | `flat-vector` |
| `chalkboard` | `dark` | `chalk` |
| `dark-atmospheric` | `dark` | `digital` |
| `editorial-infographic` | `cool` | `digital` |
| `fantasy-animation` | `pastel` | `painterly` |
| `flat-doodle` | `pastel` | `flat-vector` |
| `intuition-machine` | `retro` | `digital` |
| `minimal` | `mono` | `flat-vector` |
| `nature` | `earth` | `hand-drawn` |
| `notion` | `mono` | `digital` |
| `pixel-art` | `vivid` | `pixel` |
| `playful` | `pastel` | `hand-drawn` |
| `retro` | `retro` | `digital` |
| `sketch-notes` | `warm` | `hand-drawn` |
| `vector-illustration` | `retro` | `flat-vector` |
| `vintage` | `retro` | `hand-drawn` |
| `warm` | `warm` | `hand-drawn` |
| `warm-flat` | `warm` | `flat-vector` |
| `watercolor` | `earth` | `painterly` |

`binance-master` chooses exactly one register per cover. Scene, Mechanism, and Briefing use `isometric`; Primer overrides only the rendering dimension to `flat-vector` while retaining the `binance` palette.

## Binance Preset Specifications

- [`binance`](styles/binance.md)
- [`binance-master`](styles/binance-master.md)
- [`binance-briefing`](styles/binance-briefing.md)
- [`binance-mondo-panoramic`](styles/binance-mondo-panoramic.md)
- [`binance-sketch-notes`](styles/binance-sketch-notes.md)
- [`binance-vector-illustration`](styles/binance-vector-illustration.md)

## Override Examples

- `--style blueprint --rendering hand-drawn` = cool palette with hand-drawn rendering
- `--style elegant --palette warm` = warm palette with hand-drawn rendering

Explicit `--palette`/`--rendering` flags override ordinary preset values. For a named Binance style, first validate the requested combination against its linked specification; report a forbidden combination instead of silently weakening the style contract.
