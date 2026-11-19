# Design direction

From the mood board ("Spår", mood board 01). It sets the look of the interface, and later of the
world's light and colour.

> A quiet off-road game about Swedish backroads, weather and slow light.
>
> Ingen klocka. Ingen poäng. *Bara vägen.* (No clock. No score. Only the road.)

Flat-shaded low-poly, small and readable from a distance. Muted Nordic colour, one warm accent.
No timer, no score: just the track ahead and the marks you leave behind.

## Palette

| Name | | Hex | Used for |
|---|---|---|---|
| Granskog | Spruce | `#2F3B33` | Ink on paper, dark glass over the driving, chosen buttons |
| Mossa | Moss | `#6E7A55` | Hover, sliders, key names |
| Faluröd | Falu red | `#8E3B2D` | Destinations, the redline, the parking brake, warnings |
| Senap | Mustard 4×4 | `#C9A44A` | The one warm accent: the main button, needles, lit lamps, you on the map, the way to go |
| Björkvit | Birch | `#ECEBE6` | Paper (menus and panels), text on glass |
| Dimma | Fog | `#BFC2B6` | Soft text on glass, map backgrounds |
| Sjö | Lake | `#4E6573` | Your own start points |
| Natt | Night | `#1C2230` | Behind everything, shadows, scrims |

All of them are CSS variables in `client/src/ui/theme.css`.

## Type

- **Instrument Serif**: place names, chapter cards, titles, the journal (logbook).
- **Inter**: the interface, map labels, the few numbers shown.

Both are bundled with the game (Fontsource, SIL Open Font License), so nothing is fetched while
playing.

## Surfaces

- **Paper** for menus and panels: birch, spruce ink, serif titles, small spaced capitals over
  groups ("MAP", "VEHICLE").
- **Glass** for what sits over the driving: translucent spruce with birch text, pill-shaped
  notes, the instruments.
- **Chapter cards**: a place name in large serif that fades in over the view when you set off
  and when you arrive.

## Pillars

- **Lugn (calm).** Nothing chases you. Fail states are a stuck wheel and a winch, never a red
  screen.
- **Ljus (light).** The day moves on its own. Fog lifts, dusk comes; the palette shifts, never
  the mood.
- **Ljud (sound).** Gravel crunch, rain on the roof, an idling diesel, a distant crane call.
- **Spår (traces).** Your tyre marks stay. The map is the trail you have driven.

## A day on the track

One lake, one track, four lights; geometry stays, only the palette turns: **Gryning** (dawn, fog
in the hollows), **Dag** (clear and green), **Skymning** (dusk, headlights on), **Natt** (stars,
slow driving).
