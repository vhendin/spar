# Open questions

Questions waiting for an answer or a play-test. New ones are added as they come up; answered
ones move to the bottom with the answer, so the reasoning stays findable.

## Open

### Mud and water (f536609)

- **How stuck is stuck?** Spinning digs a tyre down to at most 25 cm. With open diffs that leaves
  the vehicle stuck in a wet bog; low range with both locks crawls out on the flat; a slope needs
  the winch. Too punishing, too easy, or about right?
- **Lighter patches on shallow water** near the shore, seen in headless screenshots. A shading
  quirk to fix, or not visible in normal play?
- **Pace off road.** Rolling resistance now acts under throttle too (it was being ignored
  whenever the wheels were driven), so grass and sand feel a little slower. Noticeable? Better?

### Night sky (88319b4, 4ff8f19)

- **Live check of the real stars, moon and aurora** in a normal browser (only seen headless so far).
- **Frame rate** at night with the aurora (`?aurora=1`) and in dense forest: the F3 read-out on
  your machine. Never measured outside the headless browser.
- **Moon glint on lakes** (this commit): a path of white glints towards the moon, four times
  brighter than its light alone would make it. Too strong, too faint?

### Light 4×4 (ltb4)

- **Feel.** Now built on the Willys M38A1's figures (this commit): 1300 kg with a driver,
  3.52 m long, 2.06 m wheelbase, 155 Nm, three gears, governed at 4000 rpm (105 km/h),
  0.375 m wheels, 23 cm clearance. Quicker and twitchier than the Terrängbil; it turns
  sharply at low speed. Too tippy, too slow, about right?
- **Differentials.** Open at the front, lockable at the back (Digit2 only), so it is clearly
  weaker off road than the military ones. The real M38A1 had no locks at all. Keep the rear
  lock, take it away, or make the front lockable too?
- **Sinking.** How deep a tyre settles depends on its size and the ground, not on the weight, so
  the light vehicle sinks about as far (relative to its wheels) as the heavy ones. Should ground
  pressure count, so it floats better over bog?
- **Colour.** Faded red. Another colour, or several to choose from?

### Terrängkombi V8 (lc200, this commit)

A Land Cruiser J200 with the European 4.5 V8 diesel, without Toyota names or badges (like the
Terrängbil without Volvo's): 2700 kg, 650 Nm at 1600–2800 rpm, six-speed automatic, low range
2.62, 0.40 m road-biased all-terrain tyres, 22.5 cm clearance, 0.7 m wading, an add-on 42 kN
winch. 0–100 km/h in about 9 s, about 200 km/h flat out.

- **Traction control instead of locks.** Both axles have open differentials with A-TRAC (new
  differential type `braked`): a spinning wheel is braked so the other one pushes with its
  half of the torque. Better than open, short of locked; there is nothing to switch. Some
  markets had a rear locker: wanted (Digit2)?
- **Feel.** On dry grass it climbs 25° in high range and 27.5° in low, grip-limited; it is
  quick and comfortable on roads but with the lower clearance and road tyres no better than
  the Terrängbil in a bog. Right balance?
- **Look.** The body generator makes it boxy (closer to an older Land Cruiser): a sloping,
  rounded bonnet and a slanted tailgate would need new body options. Worth it?
- **Colour.** Dark grey. Another?
- **Crawl control** (off-road cruise control at walking pace): wanted?

### Elpickup (elpickup, this commit)

An electric pickup on the Cybertruck's AWD dual-motor figures, without Tesla names or badges:
3020 kg (3100 with a driver), 447 kW, 10,081 Nm at the wheels, governed at 180 km/h, 5.68 m
long, 3.64 m wheelbase, 0.44 m (35") tyres, 30 cm clearance, 0.79 m wading, rear wheels
steering up to 10°, an electronically locking front differential (Digit1) and traction
control at the back. Measured: 0–100 km/h in 4.5 s (the real one about 4.3), 181 km/h flat
out; on dry grass 27.5° from standstill, grip-limited, with or without the lock; bog 10°, the
same as the Terrängkombi.

- **The sound.** No engine: a whine from the motors in a few orders of their speed (louder
  pulling or regenerating than coasting), a thin inverter whistle at low speed under load,
  the reduction gears, and below 20 km/h the soft two-note warning hum electric vehicles play
  for people on foot. Only checked headless (it plays, with no errors); how does it sound?
  Too quiet next to the tyres, too sci-fi, the warning hum annoying?
- **Regeneration.** Lifting off brakes at about 0.15 g down to a crawl, much harder than an
  engine. One-pedal driving feels like that in the real one; too strong in a game?
- **Rear-wheel steering** turns the rear wheels up to 10° against the front at walking pace,
  fading out by 60 km/h. The real one also steers them with the front at speed; wanted?
- **Air suspension.** The real one raises itself to 44 cm in an "extract" mode and lowers on
  the road. Fixed at 30 cm now. A key to raise and lower it?
- **Locks.** Wikipedia names a front locker on the dual-motor; the rear is shown as traction
  control. Lockable rear too?
- **Look.** The wedge comes from a new `body.profile` (a side outline) and light bars across
  front and back. Close enough? Stainless steel is shown as flat light grey; a metallic sheen
  would need a separate material.
- **Water.** Past 0.79 m the motors cut out ("water in the electrics") and come back a few
  seconds after leaving the water, like the engines. Should an electric vehicle wade deeper,
  or not stop at all?
- **The power dial** shows kW drawn instead of revs, and the gear lamp shows D or R. Should it
  show regeneration (a needle below zero) too?

### Interface after the mood board (this commit, `docs/DESIGN.md`)

- **Paper and glass.** Menus and panels are now birch paper with spruce ink and serif titles;
  what sits over the driving (instruments, notes, the way to go) is dark spruce glass, with
  mustard as the one accent. Right balance, or should the menus be dark too?
- **Chapter cards.** The start place fades in large over the view when you set off ("Ottsjö ·
  Vålådalen–Ottsjö · Elpickup") and the destination when you arrive. Too much, too long
  (about 4 s)? Should the line say something else, like the season or the road ("14 km
  grusväg")?
- **The beacon and the arrow** to a destination are mustard now (were orange). Still easy to
  see against autumn hills and at dusk?
- **The map itself** keeps its topographic colours, with Inter for its labels as the board
  says. Should the map be redrawn in the palette too (muted greens, birch roads)?
- **Next from the board:** the world's own light and colour ("only the palette turns": dawn
  fog in the hollows, dusk, night), and the mustard 4×4 as a vehicle colour. Wanted next?

### Seasons: colours (a0d0cec)

- **Bare trees.** Out of leaf, birch, aspen, rowan and alder crowns turn a grey-brown haze of
  the same shape. Reads as winter, or as dead trees? Real twigs would cost more triangles.
- **Calendar.** Leaves out 1–15 June, autumn colours peak around 15 September, bare from early
  October (`defs/seasons.json`). The same at every height, though spring comes later and autumn
  earlier up the fell. Right for Vålådalen? Should height shift the dates?
- **Autumn heath.** Red-brown on the open fell in September. Too strong?
- **Choosing the season.** The time panel (T) has a date slider and Winter/Spring/Summer/Autumn
  buttons. Also wanted in the start menu? The server still starts on 15 August.

### Seasons: winter snow (1f044da)

- **Snow calendar.** Snow from late October, 0.4 m by mid-December, 0.75 m at the end of March,
  gone by mid-May at 600 m; 12 % deeper per hundred metres up. Right for Vålådalen?
- **Roofs, fences and cabins** carry no snow yet. Wanted?
- **Bare birches** under snow read as grey-brown lumps at a distance; see the bare-tree question above.

### Lake ice (648da29)

- **Ice calendar.** Lakes freeze mid-November, 25 cm by mid-December, 65 cm at the end of
  March, open again early June. Right?
- **What the ice carries.** Gold's rule with a margin (7 kg per cm² squared): the 4×4 needs
  18.5 cm, the 6×6 20 cm, the light 4×4 14 cm. So in early December the light one can cross
  where the military ones go through. Too strict, too lenient?
- **Thin ice near streams.** A quarter of the full thickness where a stream runs in or out,
  back to full about 50 m away; on streams themselves 30 %. It shows dark and bare of snow.
  Enough warning, or should it be more obvious (or less)?
- **Holes.** A break-through leaves a 3.5 m hole of open water; the last 8 are kept until the
  spring thaw. Should holes freeze over again after a few in-game days?
- **Grip on ice** is 0.15; with snow on top it is the snow's 0.32.

### Driving on snow (407766a, 8657af6, 9e43570)

- **Ploughed roads.** Asphalt keeps 10 % of the snow, gravel 12 %, dirt tracks 15 %; paths are
  not cleared. The plough takes the verges too. Right?
- **Snow spray** clods look grey against the light. Mostly powder instead?

### Trips and the logbook (a5334ff)

- **Destinations.** 30 in Vålådalen from OpenStreetMap: 5 summits, 3 lodges, 2 camp sites,
  Vålåforsen, 8 viewpoints and 11 shelters. Unnamed ones are called "Viewpoint 2.4 km W of
  Ottsjö" and the like. The mountain huts are all outside the area. Worth adding lakes (reach
  the shore), or leaving out the many shelters?
- **What counts.** The clock runs only while driving (not paused, not on the map, not flying).
  Jumping to a start point or back to the start voids the trip; swapping vehicle on the way
  does not, and the arrival is logged with the vehicle you arrive in. Fair?
- **Arriving** means coming within 30 m. Summits sit on rough ground: should a summit count
  from a little further off?
- **The logbook lives in this browser** (local storage). Fine for now; with multiplayer it could
  move to the server.
- **Next layers:** timed challenges, a best-time board per place? (Fuel is set aside, see below.)

### Exhaust fumes (8b1c66c, 0d36826)

- **Strength, after the change (this commit).** Puffs now leave the pipe slower (about 1 m/s at
  idle, 4 m/s pushed) and the air stops them within about 0.3 m at idle and a metre when
  pushed, then they drift; the idle haze is fainter. Right now?
- **Air temperature** is a rough guess from the month and the sun (about -10 °C in January,
  12 °C in July, 5 °C warmer by day than at night). The plume shows below about 8 °C. Should
  the weather (clouds, rain) change the temperature too, or the height above sea level?

### Proving ground (`docs/PLAYTEST.md`)

- **Stations.** Ground strips, ramps of 10–35°, a side slope of 10–35°, a twist lane, steps,
  ditches, a boulder field, clear-cuts, a bog with a mud track, a lake with a beach, a fell
  and a forest. Anything missing, or anything to measure more exactly (a ramp at 40°, a
  deeper ford, a rock ramp without boulders)?
- **Read-outs.** Would a measuring aid help: the slope and side tilt under the vehicle in the
  F3 read-out, or a timer between two points for comparing ground?

### Big minimap (d68c603)

- **Hold Tab** and the minimap grows from the corner to about 600 px (at most 80 % of the
  window), at the same scale, so it shows about three times as far around. Big enough, too
  big? Should it grow in the corner (as now) or open in the middle of the screen? On a
  gamepad there is no hold yet; the minimap button still steps near, far, hidden.

### Real figures (this commit)

- **Climbing with the real engines.** After 920a053 felt better, the engines went back to
  their real figures: the military B30's 206 Nm (920a053 had 230, wrongly called the B30's
  figure; the civilian one gives 224), the M38A1's 155 Nm and three gears. The clutch and
  grip changes stay. On dry grass from a standstill: the 4×4 climbs 17.5° in high range (was
  20° in 920a053, 15° before) and 25° in low with the locks (was 30°); the 6×6 12.5° and 30°;
  the light 4×4 17.5° and 30°. Still feels right, or back to the stronger engine?
- **Top speed and air drag.** Air drag is now worked out from the speed (Cd·A 3.6 m² for the
  military trucks, 2.0 for the light one), replacing a hidden damping that slowed every
  movement. Flat-out on asphalt: 4×4 about 106 km/h, 6×6 104, light 4×4 105 at its governor.
  Wikipedia gives the C303 about 100 km/h. Right?
- **Load.** The trucks' gross weights (3300 kg and 4400 kg) mean up to 900 and 1580 kg in
  the back. Worth having a load to carry (heavier, lower, sinks deeper)?
- **A third truck.** The Tgb 20 (C306): 6×6, 6.05 m long, 3390 kg, bigger and taller. Wanted?

### Multiplayer (docs/MULTIPLAYER.md)

Stage 1 (seeing each other) is built; these came up on the way.

- **Headlight beams of other vehicles.** Their lamps glow, but they light nothing: every extra
  light makes all materials on screen more expensive, and adding one rebuilds them all (a
  stutter as someone joins). Fine, or should the nearest one or two others get real beams?
- **Keeping your place after a dropped connection.** Reconnecting now makes you a new player
  ("left", then "joined"). Worth keeping the slot for a minute, as planned for stage 5?
- **Chat key.** Enter opens the chat line. Does it clash with anything you are used to?
- **Paints.** Nine to choose from (the vehicle's own, Falu red, mustard, lake blue, moss, birch
  white, night, rowan orange, lingon). Enough, or a free colour picker?

## Answered

- Power on slopes: the vehicles struggled on slopes that should be easy; both power and grip
  were raised in 920a053, which felt better. The engines then went back to their real
  figures (see "Real figures" above).
- Exhaust: shot out like a water cannon, even standing still; slowed and softened.

- Drowned engine: restarting by itself three seconds after leaving the water is fine.
- Wading depths: 0.75 m for the 4×4 and 0.9 m for the 6×6 are fine.
- Lake depth: deeper, so a vehicle really disappears. Now at most 3.5 m (was 2.2), reached a
  little more slowly from the shore: about 2 m some 10 m out, deeper than a 4×4's roof about
  15 m out.
- Moonlight glinting on lakes: yes.
- Eased W on a key (9e43570): feels right together with the deep-snow retune.
- Exhaust fumes from the pipe: yes.
- Something to do on a drive: trips and the logbook (a5334ff) are the first answer; see the
  open questions about them above.
- Fuel: not now. It would take away from the experience; maybe later as an option that can be
  switched on.
- Winch keys: Z and X sat awkwardly below WASD. I winds in and K pays out (K also cancels
  choosing an anchor); low range stays on L. The developer collider view moved from K to U.
- Second vehicle: a light Jeep-style 4×4, lighter than the others. Not an ATV (a rider would have
  to be shown) and not a tractor (too dull). Added as `ltb4`.
- Keyboard throttle: ease W in gently where grip is low.
- Deep snow after the retune (8657af6) and eased W: works very well.
- Driving on snow: next after the ice. First tuning was far too hard (stuck at once); retuned.
- Frozen lakes: yes, drivable, with thin ice near streams that breaks and drowns the engine.
- Seasons: the colours first (trees, plants and ground through the year), winter snow, snow
  driving and ice after.
- Light 4×4 body: a hard top, not open, so there is no empty driver's seat to see.

- Multiplayer: started on 2026-11-19 with nothing blocking it; single-player tuning carries
  on alongside. Each region is a room (others are drawn only in the same region); anyone may
  change the time and weather, and a chat line says who did; vehicles will be solid to each
  other (stage 2); winching each other comes last; up to 5 players; each picks a paint for
  their vehicle, with name tags; text chat only; a shared destination on everyone's map, each
  arrival in your own logbook.
- Animals are on hold.
- Mountain areas are the focus; cities and flat test areas were dropped.
