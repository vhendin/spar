# Play-test route

One sitting, about an hour, covering every open question in `QUESTIONS.md` that needs
driving rather than an opinion. Part 1 is on the proving ground, a made-up 2 km test area;
part 2 is in Vålådalen, for what only real terrain shows. Note answers as you go, by the
question's name; "fine" is an answer too.

## Before you start

- Build the proving ground once (about 1½ minutes):
  `docker compose run --rm importer build proving`
- Start the game as usual and choose **Proving ground** in the start menu, or open
  `?region=proving`. Start points (M, or `&spawn=<name>`) are named after the stations.
- **F3** shows the read-out: frame rate, and per wheel the ground, grip, sink and slip.
  Keep it on for part 1.
- Set the time with **T**. Part 1 starts on a dry summer day: 20 August, 13:00, weather clear.

## The proving ground

```
 north
 ┌───────────────────────────────┬─────────────────────────────┐
 │  Ground strips (9 kinds)      │                             │
 │                               │        Proving fell         │
 │  Slopes 10°–35°        ramps→ │      (track spirals up)     │
 │  Side slope 10°→35°           │                             │
 │  Obstacles: twist, steps,     │                             │
 │  ditches, boulder field       │                             │
 │  Clear-cuts: young, fresh     │  Proving road (gravel)      │
 │  Bog + mud track │ forest     │     │    Forest + track     │
 │  Lake, beach on the east,     │     │                       │
 │  stream in, river out         │     │                       │
 └───────────────────────────────┴─────────────────────────────┘
```

A gravel road runs north–south down the middle; each station starts beside it. A cabin, a
fence and a power line stand at the north end (things to winch from).

## Part 1: proving ground

### 1. Ground strips — light 4×4 (`?vehicle=ltb4`), start "Ground strips"

Nine 30 m bands side by side, 500 m long, from north: asphalt, gravel, dirt, grass, heath,
sand, rock, scree (boulders), bog. Drive west down each one at 30–40 km/h, brake hard, then
turn sharply.

- **Pace off road:** do grass, heath and sand feel slower than gravel, and by a fitting amount?
- **Light 4×4 feel:** quick and twitchy, sharp at low speed. Too tippy, too slow, about right?
- On the bog strip: keep going or stop and try to get out. Note it for step 5.
- Repeat one strip in the 4×4 (`tgb11`) for comparison.

Then press **T** and set the weather to rain; wait a minute for the ground to soak, and drive
the dirt, grass and sand strips again. Set it back to clear.

### 2. Slopes — Terrängbil 4×4 (`tgb11`), start "Slopes"

Six grass ramps, 12 m high, at 10°, 15°, 20°, 25°, 30° and 35° from north to south. Each
rises westwards from the road side, has a flat top and a gentle way down the far side.

- Climb each in high range, then in low range (**L**) with the locks (**1 2**). Where does
  it give up? Does that match what you would expect of a real Terrängbil?
- Stop halfway up the steepest one you can climb and start again.
- Note the light 4×4 on the same ramps (is the open front diff too limiting?).

### 3. Side slope, start "Side slope"

A bank north of the ramps whose sideways tilt grows from 10° at the west end to 35° at
the east end. Drive along its face from west to east until it feels about to roll.

- **Feel:** where does each vehicle tip? Too early, too late?
- **R** puts it back on its wheels if it goes over.

### 4. Obstacles, start "Obstacles"

Three lanes from west to east, then a boulder field south of them:

- **Twist lane:** bumps under the left wheels where the right ones dip, so wheels lift.
  Try open diffs, then the locks: the locks should make the difference.
- **Steps:** 0.3, 0.5, 0.8 and 1.1 m blocks.
- **Ditches:** 0.5, 1.0 and 1.5 m deep.
- **Boulder field:** pick a line through.
- **Differentials (light 4×4):** front open, rear lockable. Keep, or should the front lock too?

### 5. Bog and mud, start "Bog"

A mire 500 m wide with a few pools, a muddy track across it, and forest on its east side.

- Drive into the bog off the track with open diffs until stuck. Then low range and both
  locks. Then the winch: **E** to choose a tree at the forest edge, **I** to winch in.
- **How stuck is stuck?** Too punishing, too easy, about right?
- **Sinking (light 4×4):** it sinks as far as the heavy ones relative to its wheels. Should
  it float better because it is lighter?
- Drive the mud track both ways.

### 6. Clear-cuts, start "Clear-cuts"

West: young trees from a felling 12 years ago. East: a fresh cut with stumps and slash.

- Push over thin trees, and try a thicker one (they should hold).
- Winch from a thin tree and pull it over.

### 7. Lake, start "Lake"

The east shore is a sand beach sloping gently into the water; a stream runs in from the
bog on the north side, a river out at the west end.

- Drive slowly straight out from the beach until the engine drowns (it should restart three
  seconds after you are back out). Then roll or winch further in, if you want to see the
  vehicle go under. Note how the water looks over the beach: **lighter patches on shallow
  water**, visible here?
- Cross the river west of the lake (a ford, about 0.4 m deep).

### 8. Winter on the same ground

**T**: set the date to 1 December, then 20 March. At each date:

- **Ice:** drive onto the lake from the beach. On 1 December it is about 16 cm thick: the
  light 4×4 (needs 14) holds, the Terrängbil 4×4 (18.5) and 6×6 (20) go through. On 20 March
  it is about 63 cm, but near the stream mouth and the river outlet it is a quarter of that
  (dark, bare of snow): the light one still holds there, the 6×6 does not.
  **What the ice carries**, **Thin ice near streams**, **Grip on ice**.
- **Snow:** the ground strips and ramps under snow (**Driving on snow**). The road is
  ploughed; the strips and ramps are not. **Snow spray**: grey clods, or too dark?
- **Exhaust:** the white plume in the cold. **Strength**: stronger, or right?

### 9. The fell, start "Fell foot"

A 320 m climb on a track spiralling up at about 12 %, forest below 750 m and open fell
above. In March the snow is about 40 % deeper at the top than at the foot.

- Drive up in March. Then come down off the track, straight down the steep side.
- At the top, choose **Proving fell** on the map (**M**) as a destination from the foot
  next time, to try a trip: **Arriving** within 30 m of a summit, fair?

## Part 2: Vålådalen

### 10. Night, 26 September, 01:00, clear

Choose Vålådalen, drive to a lake shore (Vålådalen's lakes are along the valley floor).

- **Live check of the stars, moon and aurora** (aurora with `?aurora=1`).
- **Moon glint on lakes:** too strong, too faint?
- **Frame rate:** the F3 figure, here and in dense forest, at night with the aurora.
  Note the quality preset you used (`?quality=medium` is the one `PLAN.md` asks 60 fps of).

### 11. A trip, daytime

Choose a destination from the map and drive there.

- **Destinations:** is the list useful? Too many shelters?
- **What counts:** the clock runs only while driving; jumping voids the trip; swapping
  vehicle does not. Fair?

### 12. Exhaust at idle in a breeze

Any summer day with some wind: is the haze visible at all? (**Exhaust: strength**.)

## After the session

Tell me the answers in any order; I move each to Answered in `QUESTIONS.md` and act on
the ones that need changes.
